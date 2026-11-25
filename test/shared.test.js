const { test } = require("node:test");
const assert = require("node:assert/strict");
const { instanceKey, isDarkColor, filterStacks, groupUpcoming: NcGroup, dueState, formatRelative } = require("../lib/shared");

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
	assert.equal(formatRelative(now + 59.6 * 60 * 1000, now, "en"), "in 1 hour");
	assert.equal(formatRelative(now, now, "not a locale!"), "this minute");
});

test("instanceKey separates the upcoming view from boards", () => {
	const nc = { host: "https://cloud.example.org", user: "tim" };
	const upcoming = instanceKey({ nextcloud: nc, view: "upcoming", deckBoardId: 6 });
	assert.equal(upcoming, instanceKey({ nextcloud: { ...nc, pass: "x" }, view: "upcoming" }));
	assert.notEqual(upcoming, instanceKey({ nextcloud: nc, deckBoardId: 6 }));
	assert.equal(instanceKey({ nextcloud: nc, deckBoardId: 6 }), instanceKey({ nextcloud: nc, view: "board", deckBoardId: 6 }));
});

test("groupUpcoming groups by calendar day like Deck", () => {
	const now = new Date(2026, 10, 25, 14, 0).getTime(); // Wed 14:00 local time
	const at = (days, hour) => new Date(2026, 10, 25 + days, hour, 0).getTime();
	const card = (id, due, extra = {}) => ({ id, title: `c${id}`, due, done: false, board: { id: 1, title: "Home" }, ...extra });
	const cards = [
		card(1, at(-1, 9)),
		card(2, at(0, 8)), // earlier today: "today" like in Deck, not "overdue"
		card(3, at(0, 23)),
		card(4, at(1, 0)),
		card(5, at(7, 12)),
		card(6, at(8, 12)),
		card(7, at(3, 12), { done: true }),
		card(8, at(2, 12), { board: { id: 2, title: "Work" } }),
		card(9, null)
	];
	const ids = (groups) => Object.fromEntries(groups.map((g) => [g.id, g.cards.map((c) => c.id)]));
	assert.deepEqual(ids(NcGroup(cards, now, {})), { overdue: [1], today: [2, 3], tomorrow: [4], nextSevenDays: [8, 7, 5], later: [6] });
	assert.deepEqual(ids(NcGroup(cards, now, { hideDoneCards: true, boards: ["Home"], days: 7 })), { overdue: [1], today: [2, 3], tomorrow: [4], nextSevenDays: [5] });
	assert.deepEqual(ids(NcGroup(cards, now, { boards: [2] })), { nextSevenDays: [8] });
	assert.deepEqual(ids(NcGroup(cards, now, { maxCardsPerStack: 1, days: 0 })), { overdue: [1], today: [2] });
	assert.deepEqual(NcGroup([], now, { showEmptyGroups: true }).map((g) => g.id), ["overdue", "today", "tomorrow", "nextSevenDays", "later"]);
	assert.deepEqual(NcGroup(undefined, now, {}), []);
});
