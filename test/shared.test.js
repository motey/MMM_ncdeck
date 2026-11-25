const { test } = require("node:test");
const assert = require("node:assert/strict");
const { instanceKey, isDarkColor, filterStacks, dueState, formatRelative } = require("../lib/shared");

test("instanceKey ignores trailing slashes, password and display options", () => {
	const a = instanceKey({ nextcloud: { host: "https://cloud.example.org/", user: "tim", pass: "x" }, deckBoardId: 6, hideStacks: ["Done"] });
	const b = instanceKey({ nextcloud: { host: "https://cloud.example.org", user: "tim", pass: "**SECRET_X**" }, deckBoardId: "6" });
	assert.equal(a, b);
	assert.notEqual(a, instanceKey({ nextcloud: { host: "https://cloud.example.org", user: "tim" }, deckBoardId: 7 }));
	assert.ok(!a.includes("x\""), "no password in the key");
});

test("isDarkColor follows the TinyColor brightness rule", () => {
	assert.equal(isDarkColor("000000"), true);
	assert.equal(isDarkColor("#ffffff"), false);
	assert.equal(isDarkColor("3A3B3D"), true);
	assert.equal(isDarkColor("00c9c6"), false);
	assert.equal(isDarkColor("CC317C"), true);
	assert.equal(isDarkColor("nonsense"), false);
	assert.equal(isDarkColor(null), false);
});

const stacks = [
	{ title: "Todo", cards: [{ title: "a" }, { title: "b", done: true }, { title: "c" }] },
	{ title: "Done", cards: [{ title: "d" }] }
];

test("filterStacks hides stacks, done cards and limits the count", () => {
	const result = filterStacks(stacks, { hideStacks: ["Done"], hideDoneCards: true, maxCardsPerStack: 1 });
	assert.deepEqual(result, [{ title: "Todo", cards: [{ title: "a" }] }]);
	assert.equal(stacks[0].cards.length, 3, "input stays untouched");
});

test("filterStacks without options keeps everything", () => {
	assert.deepEqual(filterStacks(stacks, {}), stacks);
	assert.deepEqual(filterStacks(stacks, { maxCardsPerStack: null }), stacks);
	assert.deepEqual(filterStacks(undefined, {}), []);
});

test("filterStacks with maxCardsPerStack 0 shows only headers", () => {
	assert.deepEqual(filterStacks(stacks, { maxCardsPerStack: 0 }).map((s) => s.cards.length), [0, 0]);
});

test("dueState", () => {
	const now = Date.UTC(2026, 10, 25, 12);
	const hour = 3600 * 1000;
	assert.equal(dueState(null, now), "none");
	assert.equal(dueState(now - 1, now), "overdue");
	assert.equal(dueState(now + 2 * hour, now), "soon");
	assert.equal(dueState(now + 48 * hour, now), "later");
});

test("formatRelative uses the locale and sensible units", () => {
	const now = Date.UTC(2026, 10, 25, 12);
	const day = 24 * 3600 * 1000;
	assert.equal(formatRelative(now + 3 * day, now, "en"), "in 3 days");
	assert.equal(formatRelative(now - day, now, "en"), "yesterday");
	assert.equal(formatRelative(now + 2 * 3600 * 1000, now, "de-DE"), "in 2 Stunden");
	assert.equal(formatRelative(now + 10 * 1000, now, "en"), "this minute");
	assert.equal(formatRelative(now, now, "not a locale!"), "this minute");
});
