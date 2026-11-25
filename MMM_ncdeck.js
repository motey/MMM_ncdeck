/*
 * MMM_ncdeck: shows a Nextcloud Deck board on the mirror, or (view: "upcoming") the cards with
 * due dates from all boards, grouped like Deck's "Upcoming cards" page.
 *
 * The browser never talks to Nextcloud and never sends credentials. It asks the node_helper
 * for "its" board by a key without secrets and renders what comes back. All text goes into
 * the page via textContent, never as HTML.
 */
Module.register("MMM_ncdeck", {
	// Keep nextcloud, deckBoardId and view in sync with SERVER_DEFAULTS in lib/service.js
	defaults: {
		view: "board", // or "upcoming"
		nextcloud: {
			host: "http://127.0.0.1",
			user: "",
			pass: ""
		},
		deckBoardId: null,
		updateIntervalSec: 120,
		hideStacks: [],
		hideDoneCards: false,
		maxCardsPerStack: null,
		coloredHeader: true,
		simpleLayout: false,
		highlightDueCards: true,
		complexLayout: {
			coloredLabels: true,
			showLabels: true,
			showAssignedUser: true
		},
		upcoming: {
			boards: [], // board IDs or titles, empty = all
			days: null, // only cards due within this many days (overdue ones always), null = all
			showBoardName: true,
			showEmptyGroups: false
		}
	},

	// MagicMirror merges defaults only one level deep, so a partial complexLayout {} would
	// lose the other defaults. Merge the nested objects here.
	setConfig (moduleConfig) {
		this.config = {
			...this.defaults,
			...moduleConfig,
			nextcloud: { ...this.defaults.nextcloud, ...moduleConfig?.nextcloud },
			complexLayout: { ...this.defaults.complexLayout, ...moduleConfig?.complexLayout },
			upcoming: { ...this.defaults.upcoming, ...moduleConfig?.upcoming }
		};
	},

	getScripts () {
		return [this.file("lib/shared.js")];
	},

	getStyles () {
		return ["MMM_ncdeck.css"];
	},

	getTranslations () {
		return { en: "translations/en.json", de: "translations/de.json" };
	},

	start () {
		this.state = null;
		this.startedAt = Date.now();
		this.lastReceived = 0;
		// lib/shared.js is loaded after setConfig(), so this happens here
		this.upcomingView = NcDeckShared.viewOf(this.config) === "upcoming";
		this.key = NcDeckShared.instanceKey(this.config);
		if (!this.upcomingView && !this.hasBoardId()) return;
		this.subscribe();

		// Every minute: refresh relative due times, and subscribe again if the helper went
		// quiet (e.g. it was restarted while this page stayed open).
		const intervalMs = Math.max(Number(this.config.updateIntervalSec) || 120, 30) * 1000;
		setInterval(() => {
			if (Date.now() - Math.max(this.lastReceived, this.startedAt) > 3 * intervalMs) this.subscribe();
			const hasDue = this.upcomingView || this.state?.stacks?.some((s) => s.cards.some((c) => c.due));
			if (!this.state || hasDue) this.updateDom();
		}, 60 * 1000);
	},

	subscribe () {
		this.sendSocketNotification("NCDECK_SUBSCRIBE", { key: this.key });
	},

	hasBoardId () {
		const id = Number(this.config.deckBoardId);
		return this.config.deckBoardId !== null && Number.isInteger(id) && id > 0;
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "NCDECK_STATE" || payload?.key !== this.key) return;
		if (!payload.ok) Log.warn(`[${this.name}] ${payload.error}`);
		this.state = payload;
		this.lastReceived = Date.now();
		this.updateDom();
	},

	getHeader () {
		if (this.data.header) return this.data.header;
		if (this.upcomingView) return this.translate("UPCOMING");
		return this.state?.board?.title || "Nextcloud Deck";
	},

	// ---- rendering ---------------------------------------------------------

	el (tag, className, text) {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	},

	message (text) {
		return this.el("div", "ncdeck-message dimmed light small", text);
	},

	getDom () {
		if (!this.upcomingView && !this.hasBoardId()) return this.message("No deckBoardId set in the config.");
		const state = this.state;
		if (!state) {
			// The helper answers within a second; no answer usually means a config mismatch
			return Date.now() - this.startedAt > 30 * 1000
				? this.message("No answer from the MagicMirror server for this board, see its log.")
				: this.message(`Loading Deck board from ${this.config.nextcloud.host} ...`);
		}
		if (this.upcomingView) return this.renderUpcoming(state);
		if (!state.board) return this.message(state.error ?? "No data.");

		const wrapper = this.el("div", "ncdeck small");
		wrapper.append(this.renderBoard(state.board, NcDeckShared.filterStacks(state.stacks, this.config)));
		if (!state.ok) wrapper.append(this.renderStaleHint(state));
		return wrapper;
	},

	renderUpcoming (state) {
		if (!state.upcoming) return this.message(state.error ?? "No data.");
		const groups = NcDeckShared.groupUpcoming(state.upcoming, Date.now(), {
			...this.config.upcoming,
			hideDoneCards: this.config.hideDoneCards,
			maxCardsPerStack: this.config.maxCardsPerStack
		});
		const wrapper = this.el("div", "ncdeck ncdeck-upcoming small");
		if (groups.length) {
			const columns = groups.map((group) => ({ title: this.translate(`GROUP_${group.id.toUpperCase()}`), cards: group.cards }));
			wrapper.append(this.renderBoard({ color: null }, columns));
		} else {
			wrapper.append(this.message(this.translate("NO_UPCOMING")));
		}
		if (!state.ok) wrapper.append(this.renderStaleHint(state));
		return wrapper;
	},

	renderBoard (board, stacks) {
		const grid = this.el("div", "ncdeck-board");
		grid.style.gridTemplateColumns = `repeat(${Math.max(stacks.length, 1)}, auto)`;
		// First all headers, then all columns: the grid puts them into two rows
		for (const stack of stacks) {
			const header = this.el("div", "ncdeck-stack-header", stack.title);
			if (this.config.coloredHeader && board.color) this.applyColor(header, board.color);
			grid.append(header);
		}
		for (const stack of stacks) {
			const column = this.el("div", "ncdeck-stack");
			for (const card of stack.cards) column.append(this.renderCard(card));
			grid.append(column);
		}
		return grid;
	},

	renderCard (card) {
		const element = this.el("div", "ncdeck-card");
		if (card.done) element.classList.add("ncdeck-card-done");
		element.append(this.el("div", "ncdeck-card-title light", card.title));
		if (this.config.simpleLayout) {
			element.classList.add("ncdeck-card-simple");
			return element;
		}
		const layout = this.config.complexLayout;
		if (layout.showLabels && card.labels.length) {
			const labels = this.el("div", "ncdeck-card-labels");
			if (!layout.coloredLabels) labels.classList.add("ncdeck-labels-gray");
			for (const label of card.labels) {
				const chip = this.el("span", "ncdeck-label xsmall bold", label.title);
				if (label.color) this.applyColor(chip, label.color);
				labels.append(chip);
			}
			element.append(labels);
		}
		const meta = this.el("div", "ncdeck-card-meta xsmall");
		if (this.upcomingView && this.config.upcoming.showBoardName && card.board?.title) {
			meta.append(this.el("span", "ncdeck-board-name", card.board.title));
		}
		if (layout.showAssignedUser && card.users.length) {
			meta.append(this.el("span", "ncdeck-user light", card.users.join(", ")));
		}
		if (card.due) meta.append(this.renderDue(card));
		if (meta.childElementCount) element.append(meta);
		return element;
	},

	renderDue (card) {
		const now = Date.now();
		const due = this.el("span", "ncdeck-duetime bright thin", NcDeckShared.formatRelative(card.due, now, this.locale()));
		const state = NcDeckShared.dueState(card.due, now);
		if (this.config.highlightDueCards && !card.done && (state === "overdue" || state === "soon")) {
			due.classList.add(`ncdeck-due-${state}`);
		}
		due.title = new Date(card.due).toLocaleString(this.locale());
		return due;
	},

	renderStaleHint (state) {
		const parts = [];
		if (state.fetchedAt) {
			const fetched = new Date(state.fetchedAt);
			const sameDay = fetched.toDateString() === new Date().toDateString();
			const options = sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "short", timeStyle: "short" };
			parts.push(`Last update ${fetched.toLocaleString(this.locale(), options)}`);
		}
		parts.push(state.error);
		return this.el("div", "ncdeck-status xsmall dimmed", parts.join(" · "));
	},

	/** Background from Deck, text light or dark depending on the background. */
	applyColor (element, hex) {
		element.style.backgroundColor = `#${hex}`;
		element.style.color = NcDeckShared.isDarkColor(hex) ? "#d3d3d3" : "#313131";
	},

	locale () {
		return config.locale || config.language || "en";
	}
});
