/*
 * Pure helpers used by both sides: the browser module loads this file via getScripts(),
 * node (node_helper and the tests) loads it with require().
 * No DOM access, no network, no globals besides the export at the end.
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) {
		module.exports = api;
	} else {
		root.NcDeckShared = api;
	}
}(typeof self !== "undefined" ? self : this, function () {
	const HOUR = 60 * 60 * 1000;

	/** Removes trailing slashes, so "https://x/" and "https://x" are the same instance. */
	function normalizeHost (host) {
		return String(host ?? "").trim().replace(/\/+$/, "");
	}

	/** "board" (one Deck board) or "upcoming" (cards with due dates from all boards). */
	function viewOf (config) {
		return config?.view === "upcoming" ? "upcoming" : "board";
	}

	/**
	 * Identifies a configured board (or the upcoming overview of an account) without any
	 * secret. The browser computes it from the config it received (passwords redacted), the
	 * node_helper from the same entry of the server-side config. Both must produce the same string.
	 * @param {object} config module config ({nextcloud: {host, user}, deckBoardId, view})
	 * @returns {string} the key
	 */
	function instanceKey (config) {
		const nc = config?.nextcloud ?? {};
		const target = viewOf(config) === "upcoming" ? "upcoming" : Number(config?.deckBoardId);
		return JSON.stringify([normalizeHost(nc.host), String(nc.user ?? ""), target]);
	}

	/**
	 * Same rule as TinyColor's isDark(): perceived brightness below 128.
	 * @param {string} hex color like "cc317c" or "#cc317c"
	 * @returns {boolean} true for dark colors (light text reads better on them)
	 */
	function isDarkColor (hex) {
		const value = String(hex ?? "").replace(/^#/, "");
		if (!/^[0-9a-f]{6}$/i.test(value)) return false;
		const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
		return (r * 299 + g * 587 + b * 114) / 1000 < 128;
	}

	/**
	 * Applies the display filters of one module instance to the board data from the helper.
	 * @param {object[]} stacks stacks as sent by the node_helper
	 * @param {object} options {hideStacks: string[], hideDoneCards: boolean, maxCardsPerStack: number|null}
	 * @returns {object[]} new stack objects, input is not modified
	 */
	function filterStacks (stacks, options = {}) {
		const hidden = new Set(options.hideStacks ?? []);
		const max = Number.isInteger(options.maxCardsPerStack) && options.maxCardsPerStack >= 0
			? options.maxCardsPerStack
			: Infinity;
		return (stacks ?? [])
			.filter((stack) => !hidden.has(stack.title))
			.map((stack) => ({
				...stack,
				cards: (stack.cards ?? [])
					.filter((card) => !(options.hideDoneCards && card.done))
					.slice(0, max)
			}));
	}

	/**
	 * @param {number|null} due due date in ms since epoch
	 * @param {number} now current time in ms
	 * @param {number} soonMs window before the due date that counts as "soon"
	 * @returns {"none"|"overdue"|"soon"|"later"} state of the due date
	 */
	function dueState (due, now, soonMs = 24 * HOUR) {
		if (!Number.isFinite(due)) return "none";
		if (due < now) return "overdue";
		if (due - now <= soonMs) return "soon";
		return "later";
	}

	const DAY = 24 * HOUR;
	const GROUPS = ["overdue", "today", "tomorrow", "nextSevenDays", "later"];

	/** Whole calendar days from `now` to `due` in local time (DST safe). */
	function calendarDaysUntil (due, now) {
		const start = (ms) => {
			const d = new Date(ms);
			return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
		};
		return Math.round((start(due) - start(now)) / DAY);
	}

	/**
	 * Groups cards with due dates like Deck's "Upcoming cards" page.
	 * @param {object[]} cards cards with `due` (ms) and `board` {id, title}
	 * @param {number} now current time in ms
	 * @param {object} options {boards: (number|string)[], days: number|null, hideDoneCards, maxCardsPerStack, showEmptyGroups}
	 * @returns {{id: string, cards: object[]}[]} groups in fixed order
	 */
	function groupUpcoming (cards, now, options = {}) {
		const boards = options.boards ?? [];
		const days = Number.isFinite(options.days) && options.days >= 0 ? options.days : Infinity;
		const max = Number.isInteger(options.maxCardsPerStack) && options.maxCardsPerStack >= 0
			? options.maxCardsPerStack
			: Infinity;
		const groups = new Map(GROUPS.map((id) => [id, []]));
		for (const card of cards ?? []) {
			if (!Number.isFinite(card.due)) continue;
			if (options.hideDoneCards && card.done) continue;
			if (boards.length && !boards.some((b) => b === card.board?.id || b === card.board?.title)) continue;
			// Calendar days like Deck: a card due earlier today is in "today", not "overdue"
			const diff = calendarDaysUntil(card.due, now);
			if (diff > days) continue;
			const id = diff < 0 ? "overdue" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff <= 7 ? "nextSevenDays" : "later";
			groups.get(id).push(card);
		}
		return GROUPS
			.map((id) => ({ id, cards: groups.get(id).sort((a, b) => a.due - b.due).slice(0, max) }))
			.filter((group) => options.showEmptyGroups || group.cards.length);
	}

	const UNITS = [
		["year", 365 * 24 * HOUR],
		["month", 30 * 24 * HOUR],
		["week", 7 * 24 * HOUR],
		["day", 24 * HOUR],
		["hour", HOUR],
		["minute", 60 * 1000]
	];

	/**
	 * "in 3 days", "vor 2 Stunden", "tomorrow": relative time in the given locale.
	 * @param {number} due target time in ms
	 * @param {number} now current time in ms
	 * @param {string} locale BCP 47 tag, e.g. "de-DE"
	 * @returns {string} the formatted text
	 */
	function formatRelative (due, now, locale) {
		let format;
		try {
			format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
		} catch {
			format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
		}
		// Whole minutes first, so 59.6 minutes reads as "in 1 hour", not "in 60 minutes"
		const diff = Math.round((due - now) / 60000) * 60000;
		for (const [unit, ms] of UNITS) {
			if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
		}
		return format.format(0, "minute");
	}

	return { normalizeHost, viewOf, instanceKey, isDarkColor, filterStacks, groupUpcoming, dueState, formatRelative };
}));
