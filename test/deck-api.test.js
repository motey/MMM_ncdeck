const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDeckClient, apiBase, toStacks, toUpcoming } = require("../lib/deck-api");

function jsonResponse (body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeFetch (handler) {
	const calls = [];
	const fetch = async (url, options) => {
		calls.push({ url: String(url), options });
		return handler(String(url), options);
	};
	return { fetch, calls };
}

const connection = { host: "https://cloud.example.org", user: "tim", pass: "s3cret" };

test("apiBase keeps sub paths and rejects bad hosts", () => {
	assert.equal(String(apiBase("https://x.org")), "https://x.org/index.php/apps/deck/api/v1.0/");
	assert.equal(String(apiBase("https://x.org/nextcloud/")), "https://x.org/nextcloud/index.php/apps/deck/api/v1.0/");
	assert.equal(String(apiBase("https://x.org/nextcloud")), "https://x.org/nextcloud/index.php/apps/deck/api/v1.0/");
	assert.throws(() => apiBase("cloud.example.org"), /not a valid URL/);
	assert.throws(() => apiBase("ftp://x.org"), /https:\/\//);
	assert.throws(() => apiBase("https://tim:pw@x.org"), /must not contain/);
});

test("requests carry basic auth, the OCS header and no redirect following", async () => {
	const { fetch, calls } = fakeFetch(() => jsonResponse({ title: "Board", color: "00C9C6", owner: { uid: "tim" } }));
	const client = createDeckClient({ ...connection, fetch });
	const board = await client.getBoard(6);
	assert.deepEqual(board, { title: "Board", color: "00c9c6" });
	assert.equal(calls[0].url, "https://cloud.example.org/index.php/apps/deck/api/v1.0/boards/6");
	assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("tim:s3cret").toString("base64")}`);
	assert.equal(calls[0].options.headers["OCS-APIRequest"], "true");
	assert.equal(calls[0].options.redirect, "manual");
});

test("invalid board ids never reach the network", async () => {
	const { fetch, calls } = fakeFetch(() => jsonResponse({}));
	const client = createDeckClient({ ...connection, fetch });
	await assert.rejects(client.getStacks("../../users"), /invalid board id/);
	await assert.rejects(client.getBoard(0), /invalid board id/);
	assert.equal(calls.length, 0);
});

test("HTTP errors become readable messages without the password", async () => {
	for (const [status, pattern] of [[401, /Login failed/], [403, /No access to board 6/], [404, /not found/], [500, /HTTP 500.*boom/]]) {
		const { fetch } = fakeFetch(() => jsonResponse({ message: "boom" }, status));
		const client = createDeckClient({ ...connection, fetch });
		await assert.rejects(client.getBoard(6), (error) => {
			assert.match(error.message, pattern);
			assert.ok(!error.message.includes("s3cret"));
			return true;
		});
	}
});

test("redirects are reported, not followed", async () => {
	const { fetch, calls } = fakeFetch(() => new Response(null, { status: 301, headers: { location: "https://other.example.org/" } }));
	const client = createDeckClient({ ...connection, fetch });
	await assert.rejects(client.getBoard(6), /redirects to https:\/\/other\.example\.org\//);
	assert.equal(calls.length, 1);
});

test("network errors and timeouts", async () => {
	const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
	let client = createDeckClient({ ...connection, fetch: async () => { throw refused; } });
	await assert.rejects(client.getBoard(6), /Cannot reach Nextcloud: connection refused \(ECONNREFUSED\)/);

	const timeout = new DOMException("timed out", "TimeoutError");
	client = createDeckClient({ ...connection, timeoutMs: 15000, fetch: async () => { throw timeout; } });
	await assert.rejects(client.getBoard(6), /No answer within 15 s/);
});

test("non-JSON answers (login page) are reported", async () => {
	const client = createDeckClient({ ...connection, fetch: async () => new Response("<html>login</html>", { status: 200 }) });
	await assert.rejects(client.getStacks(6), /not JSON/);
});

test("toStacks sorts, drops deleted and archived, and keeps only displayed fields", () => {
	const raw = [
		{ id: 2, order: 2, title: "Done", deletedAt: 0, cards: [] },
		{ id: 9, order: 1, title: "Deleted", deletedAt: 1700000000, cards: [] },
		{
			id: 1,
			order: 0,
			title: "Todo",
			deletedAt: 0,
			ETag: "x",
			cards: [
				{ id: 11, order: 5, title: "second", deletedAt: 0, archived: false, description: "private notes", owner: { uid: "tim", primaryKey: "tim" }, labels: [{ title: "Eilig", color: "CC317C", ETag: "y" }], assignedUsers: [{ participant: { uid: "tim", displayname: "Tim B", primaryKey: "tim" } }], duedate: "2020-02-13T21:01:26+00:00", done: "2026-01-01T00:00:00+00:00" },
				{ id: 10, order: 1, title: "first", deletedAt: 0, archived: false, labels: [{ title: "bad", color: "red;background:url(x)" }], assignedUsers: null, duedate: null, done: null },
				{ id: 12, order: 0, title: "archived", deletedAt: 0, archived: true },
				{ id: 13, order: 0, title: "deleted", deletedAt: 5, archived: false }
			]
		}
	];
	assert.deepEqual(toStacks(raw), [
		{
			id: 1,
			title: "Todo",
			cards: [
				{ id: 10, title: "first", labels: [{ title: "bad", color: null }], users: [], due: null, done: false },
				{ id: 11, title: "second", labels: [{ title: "Eilig", color: "cc317c" }], users: ["Tim B"], due: Date.parse("2020-02-13T21:01:26+00:00"), done: true }
			]
		},
		{ id: 2, title: "Done", cards: [] }
	]);
	assert.throws(() => toStacks({ message: "nope" }), /not an array/);
});

test("getUpcoming calls the OCS overview and keeps cards with due dates", async () => {
	const ocs = {
		ocs: {
			meta: { status: "ok" },
			data: {
				overdue: [{ id: 2, title: "late", duedate: "2026-11-20T10:00:00+00:00", boardId: 7, board: { id: 7, title: "Home" }, labels: [], assignedUsers: [], description: "secret notes" }],
				later: [{ id: 1, title: "later", duedate: "2026-12-24T10:00:00+00:00", board: { id: 3, title: "Gifts" }, labels: [{ title: "x", color: "CC317C" }], assignedUsers: [], done: null }],
				nodue: [{ id: 3, title: "no date", duedate: null, board: { id: 7, title: "Home" } }],
				today: [{ id: 4, title: "archived", duedate: "2026-11-25T10:00:00+00:00", archived: true, board: { id: 7, title: "Home" } }]
			}
		}
	};
	const { fetch, calls } = fakeFetch(() => jsonResponse(ocs));
	const client = createDeckClient({ host: "https://x.org/nextcloud", user: "tim", pass: "s3cret", fetch });
	const cards = await client.getUpcoming();
	assert.equal(calls[0].url, "https://x.org/nextcloud/ocs/v2.php/apps/deck/api/v1.0/overview/upcoming?format=json");
	assert.equal(calls[0].options.headers["OCS-APIRequest"], "true");
	assert.equal(calls[0].options.redirect, "manual");
	assert.deepEqual(cards.map((c) => [c.id, c.board.title]), [[2, "Home"], [1, "Gifts"]]);
	assert.deepEqual(cards[1], { id: 1, title: "later", labels: [{ title: "x", color: "cc317c" }], users: [], due: Date.parse("2026-12-24T10:00:00+00:00"), done: false, board: { id: 3, title: "Gifts" } });
	assert.ok(!JSON.stringify(cards).includes("secret notes"));
});

test("toUpcoming accepts a flat list and rejects other answers", () => {
	assert.equal(toUpcoming({ ocs: { data: [{ id: 1, duedate: "2026-01-01T00:00:00Z", boardId: 4 }] } })[0].board.id, 4);
	assert.throws(() => toUpcoming({ message: "nope" }), /no upcoming overview/);
});

test("upcoming 404 explains the Deck version", async () => {
	const client = createDeckClient({ ...connection, fetch: async () => jsonResponse({}, 404) });
	await assert.rejects(client.getUpcoming(), /Deck app 1\.2 or newer/);
});
