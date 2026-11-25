const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { DeckService } = require("../lib/service");
const { instanceKey } = require("../lib/shared");

const PASSWORD = "real-app-password";

function serverConfig (overrides = {}) {
	return { nextcloud: { host: "https://cloud.example.org", user: "tim", pass: PASSWORD }, deckBoardId: 6, ...overrides };
}

/** The same entry as MagicMirror sends it to browsers: password replaced by a placeholder. */
function redact (config) {
	return { ...config, nextcloud: { ...config.nextcloud, pass: "**SECRET_NEXTCLOUD_PASS**" } };
}

function setup ({ full, redacted, client } = {}) {
	full ??= [{ module: "clock" }, { module: "MMM_ncdeck", config: serverConfig() }];
	redacted ??= full.map((entry) => (entry.config ? { ...entry, config: redact(entry.config) } : entry));
	const sent = [];
	const logs = [];
	const clients = [];
	const service = new DeckService({
		moduleName: "MMM_ncdeck",
		getModules: () => ({ full, redacted }),
		send: (notification, payload) => sent.push({ notification, payload: structuredClone(payload) }),
		log: { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), error: (m) => logs.push(["error", m]) },
		createClient: (connection) => {
			clients.push(connection);
			return client ?? {
				getBoard: async () => ({ title: "TiMa ToDo", color: "00c9c6" }),
				getStacks: async () => [{ id: 1, title: "Todo", cards: [] }]
			};
		},
		now: () => 1000
	});
	return { service, sent, logs, clients };
}

const browserKey = instanceKey(redact(serverConfig()));

async function flush () {
	await new Promise((resolve) => setImmediate(resolve));
}

test("a browser gets data for its key; credentials come from the server config", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const { service, sent, clients } = setup();
	service.subscribe({ key: browserKey });
	await flush();
	assert.equal(clients.length, 1);
	assert.equal(clients[0].pass, PASSWORD);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].notification, "NCDECK_STATE");
	assert.deepEqual(sent[0].payload, { key: browserKey, ok: true, fetchedAt: 1000, board: { title: "TiMa ToDo", color: "00c9c6" }, stacks: [{ id: 1, title: "Todo", cards: [] }] });
	service.stop();
});

test("browser-supplied host and password are ignored", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const { service, sent, clients } = setup();
	// What MagicMirror hands the helper after replacing the placeholder in an attacker's payload
	service.subscribe({ key: browserKey, nextcloud: { host: "http://attacker.lan", user: "tim", pass: PASSWORD }, ncConfig: { host: "http://attacker.lan" } });
	await flush();
	assert.equal(clients[0].host, "https://cloud.example.org");
	assert.ok(!JSON.stringify(sent).includes("attacker"));
	service.stop();
});

test("unknown keys get no answer, nothing of the request is echoed or logged", async () => {
	const { service, sent, logs, clients } = setup();
	const evilKey = JSON.stringify(["http://attacker.lan", PASSWORD, 6]);
	service.subscribe({ key: evilKey });
	service.subscribe({ key: 42 });
	service.subscribe(null);
	service.subscribe({ key: "x".repeat(5000) });
	await flush();
	assert.equal(sent.length, 0);
	assert.equal(clients.length, 1, "client created from server config only");
	assert.ok(!JSON.stringify(logs).includes(PASSWORD));
	assert.ok(!JSON.stringify(logs).includes("attacker"));
});

test("nothing sent to browsers ever contains the password", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const failing = { getBoard: async () => { throw new Error("Login failed (HTTP 401)"); }, getStacks: async () => [] };
	const { service, sent, logs } = setup({ client: failing });
	service.subscribe({ key: browserKey });
	await flush();
	assert.equal(sent[0].payload.ok, false);
	assert.ok(!JSON.stringify(sent).includes(PASSWORD));
	assert.ok(!JSON.stringify(logs).includes(PASSWORD));
	service.stop();
});

test("a secret user name still matches (browser sends the placeholder, helper sees the value)", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const full = [{ module: "MMM_ncdeck", config: serverConfig({ nextcloud: { host: "https://cloud.example.org", user: "tim", pass: PASSWORD } }) }];
	const redacted = [{ module: "MMM_ncdeck", config: { ...full[0].config, nextcloud: { host: "https://cloud.example.org", user: "**SECRET_NC_USER**", pass: "**SECRET_NEXTCLOUD_PASS**" } } }];
	const { service, sent } = setup({ full, redacted });
	const keyInBrowser = instanceKey(redacted[0].config);
	// MagicMirror replaces the placeholder before the helper sees it
	service.subscribe({ key: keyInBrowser.replace("**SECRET_NC_USER**", "tim") });
	await flush();
	assert.equal(sent.length, 1);
	assert.equal(sent[0].payload.key, keyInBrowser, "answer uses the redacted key");
	service.stop();
});

test("errors keep the last good data and are logged once", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let fail = false;
	const client = {
		getBoard: async () => {
			if (fail) throw new Error("No answer within 15 s");
			return { title: "B", color: null };
		},
		getStacks: async () => [{ id: 1, title: "Todo", cards: [] }]
	};
	const { service, sent, logs } = setup({ client });
	service.subscribe({ key: browserKey });
	await flush();
	fail = true;
	t.mock.timers.tick(120 * 1000);
	await flush();
	t.mock.timers.tick(120 * 1000);
	await flush();
	const last = sent.at(-1).payload;
	assert.equal(last.ok, false);
	assert.equal(last.error, "No answer within 15 s");
	assert.equal(last.board.title, "B");
	assert.equal(last.fetchedAt, 1000);
	assert.equal(logs.filter(([level]) => level === "error").length, 1);
	fail = false;
	t.mock.timers.tick(120 * 1000);
	await flush();
	assert.equal(sent.at(-1).payload.ok, true);
	assert.ok(logs.some(([level, m]) => level === "info" && m.includes("working again")));
	service.stop();
});

test("one poller per board, shared by all browsers; late subscribers get the cache", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const getBoard = mock.fn(async () => ({ title: "B", color: null }));
	const { service, sent } = setup({ client: { getBoard, getStacks: async () => [] } });
	service.subscribe({ key: browserKey });
	await flush();
	service.subscribe({ key: browserKey });
	await flush();
	assert.equal(getBoard.mock.callCount(), 1);
	assert.equal(sent.length, 2);
	t.mock.timers.tick(120 * 1000);
	await flush();
	assert.equal(getBoard.mock.callCount(), 2);
	service.stop();
});

test("intervals below 30 s are raised to 30 s", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const getBoard = mock.fn(async () => ({ title: "B", color: null }));
	const full = [{ module: "MMM_ncdeck", config: serverConfig({ updateIntervalSec: 1 }) }];
	const { service } = setup({ full, client: { getBoard, getStacks: async () => [] } });
	service.subscribe({ key: browserKey });
	await flush();
	t.mock.timers.tick(29 * 1000);
	await flush();
	assert.equal(getBoard.mock.callCount(), 1);
	t.mock.timers.tick(1000);
	await flush();
	assert.equal(getBoard.mock.callCount(), 2);
	service.stop();
});

test("config problems are reported to the mirror without polling", async () => {
	const cases = [
		[{ deckBoardId: null }, /deckBoardId/],
		[{ nextcloud: { host: "https://cloud.example.org", user: "", pass: "x" } }, /nextcloud.user/],
		[{ nextcloud: { host: "https://cloud.example.org", user: "tim", pass: "${SECRET_NEXTCLOUD_PASS}" } }, /variable for nextcloud.pass/],
		[{ nextcloud: { host: "https://cloud.example.org", user: "tim", pass: "" } }, /nextcloud.pass is not set/]
	];
	for (const [overrides, pattern] of cases) {
		const full = [{ module: "MMM_ncdeck", config: serverConfig(overrides) }];
		const { service, sent, clients } = setup({ full });
		service.subscribe({ key: instanceKey(redact(full[0].config)) });
		await flush();
		assert.equal(clients.length, 0);
		assert.equal(sent.length, 1);
		assert.match(sent[0].payload.error, pattern);
	}
});

test("a client that rejects the host is reported", async () => {
	const full = [{ module: "MMM_ncdeck", config: serverConfig({ nextcloud: { host: "cloud.example.org", user: "tim", pass: PASSWORD } }) }];
	const sent = [];
	const service = new DeckService({
		moduleName: "MMM_ncdeck",
		getModules: () => ({ full, redacted: full.map((e) => ({ ...e, config: redact(e.config) })) }),
		send: (notification, payload) => sent.push(payload),
		log: { info () {}, warn () {}, error () {} }
	});
	service.subscribe({ key: instanceKey(redact(full[0].config)) });
	await flush();
	assert.match(sent[0].error, /not a valid URL/);
});

test("warns when the password is visible to browsers", () => {
	const full = [{ module: "MMM_ncdeck", config: serverConfig() }];
	const { service, logs } = setup({ full, redacted: structuredClone(full) });
	service.loadInstances();
	assert.ok(logs.some(([level, m]) => level === "warn" && m.includes("plain text")));
	assert.ok(!JSON.stringify(logs).includes(PASSWORD));
});

test("disabled entries and other modules are ignored", () => {
	const full = [
		{ module: "MMM_ncdeck", disabled: true, config: serverConfig() },
		{ module: "calendar", config: serverConfig() }
	];
	const { service, clients } = setup({ full });
	assert.equal(service.loadInstances().size, 0);
	assert.equal(clients.length, 0);
});

test("the upcoming view needs no board id and sends the upcoming cards", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const config = { nextcloud: { host: "https://cloud.example.org", user: "tim", pass: PASSWORD }, view: "upcoming" };
	const full = [{ module: "MMM_ncdeck", config }, { module: "MMM_ncdeck", config: serverConfig() }];
	const getUpcoming = mock.fn(async () => [{ id: 1, title: "late", due: 5, board: { id: 7, title: "Home" } }]);
	const { service, sent } = setup({ full, client: { getUpcoming, getBoard: async () => ({ title: "B" }), getStacks: async () => [] } });
	const key = instanceKey(redact(config));
	assert.equal(service.loadInstances().size, 2);
	service.subscribe({ key });
	await flush();
	assert.equal(getUpcoming.mock.callCount(), 1);
	assert.deepEqual(sent[0].payload, { key, ok: true, fetchedAt: 1000, upcoming: [{ id: 1, title: "late", due: 5, board: { id: 7, title: "Home" } }] });
	service.stop();
});
