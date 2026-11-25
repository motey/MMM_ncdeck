/*
 * Server side of MMM_ncdeck: one poller per configured board, shared by all browsers.
 *
 * Security model
 * --------------
 * Connection settings (host, user, password, board) come ONLY from the server-side config
 * (global.config). A browser sends nothing but the key of the board it wants, and receives
 * the board data. It cannot make the server contact another host.
 *
 * MagicMirror replaces "**SECRET_...**" placeholders in every payload a browser sends to a
 * node_helper with the real value. Anything a browser sends may therefore contain the
 * password in plain text after that step. This file never echoes, logs or stores
 * browser input; it only compares the key with the known keys.
 */
const { createDeckClient } = require("./deck-api");
const { instanceKey, viewOf } = require("./shared");

const MIN_INTERVAL_MS = 30 * 1000;
const MAX_KEY_LENGTH = 2000;

/** Defaults for the settings the server side uses. Keep in sync with MMM_ncdeck.js. */
const SERVER_DEFAULTS = {
	nextcloud: { host: "http://127.0.0.1", user: "", pass: "" },
	deckBoardId: null,
	view: "board",
	updateIntervalSec: 120
};

/** MagicMirror merges defaults only one level deep; nextcloud {} is merged here as well. */
function withDefaults (config) {
	const merged = {
		...SERVER_DEFAULTS,
		...config,
		nextcloud: { ...SERVER_DEFAULTS.nextcloud, ...config?.nextcloud }
	};
	// Older READMEs allowed "6" as well as 6
	if (merged.deckBoardId !== null && merged.deckBoardId !== undefined) merged.deckBoardId = Number(merged.deckBoardId);
	return merged;
}

/** Problems that make polling pointless. Returns a message for the mirror or null. */
function configError (config) {
	const { host, user, pass } = config.nextcloud;
	if (viewOf(config) === "board" && (!Number.isInteger(config.deckBoardId) || config.deckBoardId <= 0)) {
		return "deckBoardId must be the number of the board (see the README)";
	}
	if (!user) return "nextcloud.user is not set";
	if (/^\$\{.+\}$/.test(String(pass)) || String(pass).startsWith("**SECRET_")) {
		return "the variable for nextcloud.pass is not set (config.env or environment)";
	}
	if (!pass) return "nextcloud.pass is not set";
	if (/^\$\{.+\}$/.test(String(host)) || /^\$\{.+\}$/.test(String(user))) {
		return "a variable in the nextcloud settings is not set (config.env or environment)";
	}
	return null;
}

class DeckService {
	/**
	 * @param {object} options dependencies
	 * @param {string} options.moduleName "MMM_ncdeck"
	 * @param {Function} options.getModules () => ({full, redacted}): module lists of the server config
	 * @param {Function} options.send (notification, payload) => void, reaches all browsers
	 * @param {object} options.log logger with info/warn/error
	 * @param {Function} [options.createClient] factory for the Deck client (tests)
	 * @param {Function} [options.now] clock (tests)
	 */
	constructor ({ moduleName, getModules, send, log, createClient = createDeckClient, now = Date.now }) {
		this.moduleName = moduleName;
		this.getModules = getModules;
		this.send = send;
		this.log = log;
		this.createClient = createClient;
		this.now = now;
		this.instances = null;
	}

	/** Reads all MMM_ncdeck entries from the server config (once). */
	loadInstances () {
		if (this.instances) return this.instances;
		this.instances = new Map();
		const { full = [], redacted } = this.getModules() ?? {};
		if (!redacted) {
			this.log.warn(`[${this.moduleName}] cannot check whether the password reaches browsers (MagicMirror older than 2.38?). Use a \${SECRET_...} variable for nextcloud.pass.`);
		}
		full.forEach((entry, index) => {
			if (entry?.module !== this.moduleName || entry.disabled === true) return;
			const config = withDefaults(entry.config);
			// Same entry as the browser got it: secrets are "**SECRET_X**" placeholders there
			const redactedEntry = redacted?.[index]?.module === this.moduleName ? redacted[index] : entry;
			const publicConfig = withDefaults(redactedEntry.config);
			const publicKey = instanceKey(publicConfig);
			const fullKey = instanceKey(config);
			if (this.findInstance(publicKey) || this.findInstance(fullKey)) return; // same board twice: share the poller

			const view = viewOf(config);
			const label = view === "upcoming" ? "upcoming overview" : `board ${config.deckBoardId}`;
			const pass = String(config.nextcloud.pass ?? "");
			if (redacted && pass && publicConfig.nextcloud.pass === pass) {
				this.log.warn(`[${this.moduleName}] ${label}: nextcloud.pass is sent to every browser in plain text. Put it in config.env as SECRET_... and write pass: "\${SECRET_...}" in config.js.`);
			}

			const instance = { publicKey, fullKey, label, view, config, timer: null, busy: false, state: null, lastError: null, client: null };
			const problem = configError(config);
			if (problem) {
				instance.state = { key: publicKey, ok: false, error: problem, failedAt: this.now() };
				this.log.error(`[${this.moduleName}] ${label}: ${problem}`);
			} else {
				try {
					instance.client = this.createClient(config.nextcloud);
				} catch (error) {
					instance.state = { key: publicKey, ok: false, error: error.message, failedAt: this.now() };
					this.log.error(`[${this.moduleName}] ${label}: ${error.message}`);
				}
			}
			this.instances.set(publicKey, instance);
		});
		return this.instances;
	}

	findInstance (key) {
		if (!this.instances) return null;
		for (const instance of this.instances.values()) {
			if (instance.publicKey === key || instance.fullKey === key) return instance;
		}
		return null;
	}

	/**
	 * A browser module asks for its board. payload: {key}. The key may contain secrets after
	 * MagicMirror's placeholder replacement, so it is only compared, never sent back or logged.
	 * @param {object} payload socket payload from the browser
	 */
	subscribe (payload) {
		const key = payload?.key;
		if (typeof key !== "string" || key.length > MAX_KEY_LENGTH) return;
		this.loadInstances();
		const instance = this.findInstance(key);
		if (!instance) {
			this.log.warn(`[${this.moduleName}] a browser asked for a board that is not in the server config; ignored`);
			return;
		}
		if (instance.state) this.send("NCDECK_STATE", instance.state);
		if (instance.client && !instance.timer) {
			const interval = Math.max((Number(instance.config.updateIntervalSec) || SERVER_DEFAULTS.updateIntervalSec) * 1000, MIN_INTERVAL_MS);
			instance.timer = setInterval(() => this.refresh(instance), interval);
			this.refresh(instance);
		}
	}

	async refresh (instance) {
		if (instance.busy) return;
		instance.busy = true;
		try {
			const data = await this.fetchData(instance);
			if (instance.lastError) this.log.info(`[${this.moduleName}] ${instance.label}: working again`);
			instance.lastError = null;
			instance.state = { key: instance.publicKey, ok: true, fetchedAt: this.now(), ...data };
		} catch (error) {
			const message = error?.message ?? String(error);
			// Log each new problem once, not every interval
			if (message !== instance.lastError) this.log.error(`[${this.moduleName}] ${instance.label}: ${message}`);
			instance.lastError = message;
			// Keep the last good data, the mirror shows it with a "last update" hint
			const { board, stacks, upcoming, fetchedAt } = instance.state ?? {};
			instance.state = { key: instance.publicKey, ok: false, error: message, failedAt: this.now(), board, stacks, upcoming, fetchedAt };
		} finally {
			instance.busy = false;
		}
		this.send("NCDECK_STATE", instance.state);
	}

	/** {board, stacks} for a board, {upcoming: cards} for the upcoming overview. */
	async fetchData (instance) {
		if (instance.view === "upcoming") return { upcoming: await instance.client.getUpcoming() };
		const boardId = instance.config.deckBoardId;
		const [board, stacks] = await Promise.all([instance.client.getBoard(boardId), instance.client.getStacks(boardId)]);
		return { board, stacks };
	}

	stop () {
		for (const instance of this.instances?.values() ?? []) {
			clearInterval(instance.timer);
			instance.timer = null;
		}
	}
}

module.exports = { DeckService, SERVER_DEFAULTS, withDefaults, configError };
