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

	/**
	 * Identifies a configured board without any secret. The browser computes it from the
	 * config it received (passwords redacted), the node_helper from the same entry of the
	 * server-side config. Both sides must produce the same string.
	 * @param {object} config module config ({nextcloud: {host, user}, deckBoardId})
	 * @returns {string} the key
	 */
	function instanceKey (config) {
		const nc = config?.nextcloud ?? {};
		return JSON.stringify([normalizeHost(nc.host), String(nc.user ?? ""), Number(config?.deckBoardId)]);
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
		const diff = due - now;
		for (const [unit, ms] of UNITS) {
			if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
		}
		return format.format(0, "minute");
	}

	return { normalizeHost, instanceKey, isDarkColor, filterStacks, dueState, formatRelative };
}));
