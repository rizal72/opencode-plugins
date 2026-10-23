// oc-session-search: keyword search over past OpenCode sessions.
//
// The transcripts live in SQLite (<data dir>/opencode/opencode.db, table session_message.data), not in
// files, so the two-phase trick used on Pi (rg -l, then read only the candidates) collapses into one
// LIKE prefilter: a full scan of the 14 MB of message text costs about 50 ms. The regex itself runs in
// JS on the rows SQL returned, because SQLite has no REGEXP and JS keeps the semantics Pi had.
//
// The SQLite is the host's own (`bun:sqlite` — OpenCode is a Bun binary), so installing the plugin needs
// nothing else on any platform. The `sqlite3` CLI stays as the fallback, and it is the path the
// self-check takes when it runs under node.
//
// Runnable standalone for its self-check: node plugins/oc-session-search/search.ts --self-check

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface SearchOptions {
	/** Case-insensitive regular expression. */
	query: string
	/** Substring of the directory a session belongs to, e.g. "OpenCode". */
	project?: string
	/** Earliest date, YYYY-MM-DD. */
	since?: string
	/** Max hits, default 10, max 40. */
	limit?: number
	/** Override for the self-check. */
	database?: string
	signal?: AbortSignal
}

export interface SearchHit {
	session: string
	title: string
	project: string
	date: string
	role: string
	snippet: string
}

interface Row {
	id: string
	directory: string
	title: string | null
	type: string
	time_created: number
	data: string
}

/** Rows handed from SQL to JS. Enough to survive a broad prefix, small enough to stay a few MB. */
const ROWS = 400
const MATCHES_PER_SESSION = 3
const SNIPPET_BEFORE = 120
const SNIPPET_AFTER = 200

export function databasePath(): string {
	const data = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
	return process.env.OPENCODE_DB ?? join(data, "opencode", "opencode.db")
}

/** The longest run of word characters: the only part of a regex SQLite can prefilter with LIKE. */
export function needle(query: string): string | undefined {
	return query.match(/[A-Za-z0-9_]{2,}/g)?.sort((a, b) => b.length - a.length)[0]
}

/** JSON escapes turned back into text, so the regex matches prose and the snippet is readable. */
export function plain(data: string): string {
	return data
		.replace(/\\\\/g, "\u0000")
		.replace(/\\[nrt]/g, " ")
		.replace(/\\"/g, '"')
		.replace(/\u0000/g, "\\")
}

/** The host's own SQLite, loaded once: OpenCode is a Bun binary, so this is always there. */
let host: typeof import("bun:sqlite") | undefined | false

async function hostSqlite() {
	if (host === undefined) {
		try {
			host = await import("bun:sqlite")
		} catch {
			// Node, which has no `bun:` scheme: the self-check's path, and the CLI below.
			host = false
		}
	}
	return host || undefined
}

async function rows(database: string, term: string, signal?: AbortSignal): Promise<Row[]> {
	const sql =
		"select s.id, s.directory, s.title, m.type, m.time_created, m.data" +
		" from session_message m join session_v2 s on s.id = m.session_id" +
		" where m.data like '%' || '" +
		term.replace(/'/g, "''") +
		"' || '%'" +
		" order by m.time_created desc limit " +
		ROWS
	const sqlite = await hostSqlite()
	if (sqlite) {
		try {
			const db = new sqlite.Database(database, { readonly: true })
			try {
				return db.query(sql).all() as Row[]
			} finally {
				db.close()
			}
		} catch {
			// A read-only open of a live WAL database is the one thing that can differ per host:
			// fall through to the CLI rather than lose the tool.
		}
	}
	return new Promise((resolve, reject) => {
		execFile(
			"sqlite3",
			["file:" + database + "?mode=ro", "-json", sql],
			{ maxBuffer: 64 * 1024 * 1024, signal },
			(error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout || "[]") as Row[])),
		)
	})
}

/** The prose of a message: `text`, or the text parts of a reply, tool calls and reasoning excluded. */
export function textOf(data: string): string | undefined {
	try {
		const entry = JSON.parse(data) as { text?: unknown; content?: unknown }
		if (typeof entry.text === "string" && entry.text) return entry.text
		if (!Array.isArray(entry.content)) return undefined
		const parts = entry.content
			.filter((part: any) => part && part.type !== "tool" && typeof part.text === "string")
			.map((part: any) => part.text as string)
		return parts.length > 0 ? parts.join(" ") : undefined
	} catch {
		return undefined
	}
}

export function hit(row: Row, index: number, source: string): SearchHit {
	const start = Math.max(0, index - SNIPPET_BEFORE)
	return {
		session: row.id,
		title: row.title ?? "(untitled)",
		project: row.directory.split("/").pop() ?? row.directory,
		date: new Date(row.time_created).toLocaleDateString("en-CA"),
		role: row.type,
		snippet: source.slice(start, index + SNIPPET_AFTER).replace(/\s+/g, " ").trim(),
	}
}

export function format(hits: SearchHit[], query: string, sessionCount: number): string {
	if (hits.length === 0) return "No session match for /" + query + "/ (scanned " + sessionCount + " session(s))."
	const header =
		hits.length +
		" hit(s) for /" +
		query +
		"/ in " +
		sessionCount +
		" session(s). Snippet is raw transcript text; read a whole session with " +
		"`opencode api get /api/session/<id>/message`."
	const lines = hits.map(
		(h) => h.date + " " + h.project + " " + h.session + ' "' + h.title + '" [' + h.role + "] " + h.snippet,
	)
	return [header, ...lines].join("\n")
}

export async function searchSessions(options: SearchOptions): Promise<{
	hits: SearchHit[]
	sessions: number
	text: string
}> {
	const limit = Math.min(Math.max(options.limit ?? 10, 1), 40)
	const term = needle(options.query)
	if (!term) {
		const text = "The query needs at least one literal word of two or more letters or digits."
		return { hits: [], sessions: 0, text }
	}
	let re: RegExp
	try {
		re = new RegExp(options.query, "i")
	} catch (error) {
		const text = "Invalid regular expression: " + (error instanceof Error ? error.message : String(error))
		return { hits: [], sessions: 0, text }
	}
	const database = options.database ?? databasePath()
	if (!existsSync(database)) {
		const text = "No session database at " + database + "."
		return { hits: [], sessions: 0, text }
	}

	const project = options.project?.toLowerCase()
	const scored: Array<{ hit: SearchHit; prose: boolean }> = []
	for (const row of await rows(database, term, options.signal)) {
		if (project && !row.directory.toLowerCase().includes(project)) continue
		const date = new Date(row.time_created).toLocaleDateString("en-CA")
		if (options.since && date < options.since) continue
		// Prose first, tool payloads only as filler: a search for a discussed topic wants the sentence,
		// not the command that happened to name it.
		const prose = textOf(row.data)
		const at = prose === undefined ? -1 : prose.search(re)
		if (at >= 0) {
			scored.push({ hit: hit(row, at, prose as string), prose: true })
			continue
		}
		const raw = plain(row.data)
		const atRaw = raw.search(re)
		if (atRaw >= 0) scored.push({ hit: hit(row, atRaw, raw), prose: false })
	}

	const hits: SearchHit[] = []
	const perSession = new Map<string, number>()
	const ordered = scored.filter((s) => s.prose).concat(scored.filter((s) => !s.prose))
	// One hit per session first: when the owner asks "did we discuss this?", the answer is a session,
	// not four consecutive messages of the same one. Extra snippets only fill what the limit leaves.
	const pick = (cap: number) => {
		for (const { hit: candidate } of ordered) {
			if (hits.length >= limit) return
			const count = perSession.get(candidate.session) ?? 0
			if (count >= cap) continue
			perSession.set(candidate.session, count + 1)
			hits.push(candidate)
		}
	}
	pick(1)
	pick(MATCHES_PER_SESSION)
	const sessions = new Set(scored.map((s) => s.hit.session)).size
	return { hits, sessions, text: format(hits, options.query, sessions) }
}

// Self-check: node plugins/oc-session-search/search.ts --self-check
if (process.argv[2] === "--self-check") {
	const run = async () => {
		const probe = await searchSessions({ query: "session_search", limit: 3 })
		if (probe.hits.length === 0) throw new Error("self-check: expected at least one hit for session_search")
		if (probe.hits.length > 3) throw new Error("self-check: limit not honoured")
		if (probe.hits.some((h) => h.snippet.includes("\n"))) throw new Error("self-check: snippet must be single-line")
		if (probe.hits.some((h) => !h.session.startsWith("ses_"))) throw new Error("self-check: session id missing")
		const miss = await searchSessions({ query: "zzz" + Math.random().toString(36).slice(2) })
		if (miss.hits.length !== 0) throw new Error("self-check: expected no hits")
		const filtered = await searchSessions({ query: "session_search", project: "OpenCode", limit: 2 })
		if (filtered.hits.some((h) => h.project !== "OpenCode")) throw new Error("self-check: project filter leaked")
		const bad = await searchSessions({ query: "([unclosed" })
		if (!/Invalid regular expression/.test(bad.text)) throw new Error("self-check: bad regex not reported")
		console.log("self-check ok: " + probe.hits.length + " hits, sample -> " + probe.hits[0].snippet.slice(0, 90))
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
