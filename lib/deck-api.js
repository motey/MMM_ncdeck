/*
 * Minimal client for the Nextcloud Deck REST API (read only).
 * https://deck.readthedocs.io/en/latest/API/
 * The upcoming overview uses the OCS endpoint of Deck's own "Upcoming cards" page, which is
 * not part of the documented API (stable since Deck 1.2, checked against Deck in Nextcloud 34).
 *
 * Returns only the fields the mirror displays. Owner, e-mail addresses, descriptions,
 * ETags and the like never leave this file.
 */
const API_PATH = "index.php/apps/deck/api/v1.0/";
const OCS_PATH = "ocs/v2.php/apps/deck/api/v1.0/";
const DEFAULT_TIMEOUT_MS = 15000;

class DeckApiError extends Error {}

/**
 * @param {string} host Nextcloud base URL, may include a sub path ("https://example.org/nextcloud")
 * @returns {URL} the Nextcloud base URL, ending with "/"
 */
function hostBase (host) {
	let url;
	try {
		url = new URL(String(host ?? "").trim());
	} catch {
		throw new DeckApiError(`nextcloud.host is not a valid URL: "${host}"`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new DeckApiError(`nextcloud.host must start with https:// or http://, got "${url.protocol}"`);
	}
	if (url.username || url.password) {
		throw new DeckApiError("nextcloud.host must not contain a user name or password, use nextcloud.user and nextcloud.pass");
	}
	url.search = "";
	url.hash = "";
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}

/** Base URL of the Deck REST API. */
function apiBase (host) {
	return new URL(API_PATH, hostBase(host));
}

/**
 * Readable message for a failed response, without echoing anything secret.
 * @param {Response} response the failed response
 * @param {number|null} boardId board of the request, null for the upcoming overview
 * @returns {Promise<string>} the message
 */
async function describeHttpError (response, boardId) {
	switch (response.status) {
		case 401:
			return "Login failed (HTTP 401): check nextcloud.user and the app password";
		case 403:
			return boardId
				? `No access to board ${boardId} (HTTP 403): share the board with this user`
				: "No access to the upcoming overview (HTTP 403)";
		case 404:
			return boardId
				? `Board ${boardId} not found (HTTP 404): check deckBoardId and that the Deck app is enabled`
				: "Upcoming overview not found (HTTP 404): needs the Deck app 1.2 or newer";
		default: {
			let detail = "";
			try {
				const body = await response.json();
				if (typeof body?.message === "string") detail = `: ${body.message.slice(0, 200)}`;
			} catch {
				// body is not JSON, the status is all we have
			}
			return `HTTP ${response.status} ${response.statusText}${detail}`.trim();
		}
	}
}

const NETWORK_ERRORS = {
	ENOTFOUND: "host name not found",
	EAI_AGAIN: "DNS lookup failed",
	ECONNREFUSED: "connection refused",
	ECONNRESET: "connection reset",
	EHOSTUNREACH: "host unreachable",
	ENETUNREACH: "network unreachable",
	ETIMEDOUT: "connection timed out",
	CERT_HAS_EXPIRED: "TLS certificate expired",
	DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed TLS certificate",
	UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate not trusted",
	ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the host name"
};

function describeNetworkError (error, timeoutMs) {
	if (error?.name === "TimeoutError") return `No answer within ${Math.round(timeoutMs / 1000)} s`;
	const code = error?.cause?.code;
	const reason = NETWORK_ERRORS[code] ? `${NETWORK_ERRORS[code]} (${code})` : (code ?? error?.cause?.message ?? error?.message ?? String(error));
	return `Cannot reach Nextcloud: ${reason}`;
}

/** Deck sends colors as "cc317c". Anything else is dropped instead of ending up in CSS. */
function color (value) {
	return typeof value === "string" && /^[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function text (value) {
	return typeof value === "string" ? value : "";
}

function byOrder (a, b) {
	return (a.order ?? 0) - (b.order ?? 0) || (a.id ?? 0) - (b.id ?? 0);
}

/** Card as the browser needs it. */
function toCard (card) {
	const due = card.duedate ? Date.parse(card.duedate) : Number.NaN;
	return {
		id: card.id,
		title: text(card.title),
		labels: (card.labels ?? []).map((label) => ({ title: text(label.title), color: color(label.color) })),
		users: (card.assignedUsers ?? [])
			.map((assignment) => text(assignment?.participant?.displayname || assignment?.participant?.uid))
			.filter(Boolean),
		due: Number.isFinite(due) ? due : null,
		// "done" exists since Deck 1.13 and holds the time the card was marked done
		done: Boolean(card.done)
	};
}

function toStacks (stacks) {
	if (!Array.isArray(stacks)) throw new DeckApiError("Unexpected answer from Deck: stack list is not an array");
	return stacks
		.filter((stack) => !stack.deletedAt)
		.sort(byOrder)
		.map((stack) => ({
			id: stack.id,
			title: text(stack.title),
			cards: (stack.cards ?? [])
				.filter((card) => !card.deletedAt && !card.archived)
				.sort(byOrder)
				.map(toCard)
		}));
}

/**
 * Cards with a due date from the upcoming overview, with their board. Deck groups them by day
 * (overdue, today, ...) on the server; the groups are flattened here and rebuilt in the browser
 * in local time. Cards without a due date are dropped.
 * @param {object} body OCS answer {ocs: {data: {groupName: [card, ...]}}}
 * @returns {object[]} cards sorted by due date
 */
function toUpcoming (body) {
	const data = body?.ocs?.data;
	if (!data || typeof data !== "object") throw new DeckApiError("Unexpected answer from Deck: no upcoming overview in the response");
	const all = Array.isArray(data) ? data : Object.values(data).flat();
	const seen = new Set();
	return all
		.filter((card) => card && typeof card === "object" && card.duedate && !card.deletedAt && !card.archived)
		.filter((card) => !seen.has(card.id) && seen.add(card.id))
		.map((card) => ({
			...toCard(card),
			board: { id: card.board?.id ?? card.boardId ?? null, title: text(card.board?.title) }
		}))
		.filter((card) => card.due !== null)
		.sort((a, b) => a.due - b.due || a.id - b.id);
}

function toBoard (board) {
	if (!board || typeof board !== "object") throw new DeckApiError("Unexpected answer from Deck: board is not an object");
	return { title: text(board.title), color: color(board.color) };
}

/**
 * @param {object} options connection settings
 * @param {string} options.host Nextcloud base URL
 * @param {string} options.user Nextcloud user
 * @param {string} options.pass app password
 * @param {Function} [options.fetch] fetch implementation (tests)
 * @param {number} [options.timeoutMs] per request timeout
 * @returns {{getBoard: Function, getStacks: Function, getUpcoming: Function}} the client
 */
function createDeckClient ({ host, user, pass, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const base = apiBase(host);
	const ocsBase = new URL(OCS_PATH, hostBase(host));
	const authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

	function checkBoardId (boardId) {
		if (!Number.isInteger(boardId) || boardId <= 0) throw new DeckApiError(`invalid board id: ${boardId}`);
	}

	async function get (url, boardId) {
		let response;
		try {
			response = await fetch(url, {
				headers: {
					Authorization: authorization,
					"OCS-APIRequest": "true",
					Accept: "application/json"
				},
				// Never follow a redirect with the password attached, report it instead
				redirect: "manual",
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (error) {
			throw new DeckApiError(describeNetworkError(error, timeoutMs));
		}
		if (response.status >= 300 && response.status < 400) {
			const target = response.headers.get("location") ?? "?";
			throw new DeckApiError(`Nextcloud redirects to ${target} (HTTP ${response.status}): use the final address as nextcloud.host`);
		}
		if (!response.ok) throw new DeckApiError(await describeHttpError(response, boardId));
		try {
			return await response.json();
		} catch {
			throw new DeckApiError("Unexpected answer from Deck (not JSON): is nextcloud.host the Nextcloud base URL?");
		}
	}

	return {
		async getBoard (boardId) {
			checkBoardId(boardId);
			return toBoard(await get(new URL(`boards/${boardId}`, base), boardId));
		},
		async getStacks (boardId) {
			checkBoardId(boardId);
			return toStacks(await get(new URL(`boards/${boardId}/stacks`, base), boardId));
		},
		async getUpcoming () {
			return toUpcoming(await get(new URL("overview/upcoming?format=json", ocsBase), null));
		}
	};
}

module.exports = { createDeckClient, apiBase, DeckApiError, toBoard, toStacks, toUpcoming };
