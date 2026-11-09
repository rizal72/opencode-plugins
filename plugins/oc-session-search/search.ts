// oc-session-search: keyword search over past OpenCode sessions.
//
// The transcripts live in the host's own SQLite file, opened read-only. There is no index and nothing
// is written; the trade, the measurements and the reasons are in docs/oc-session-search.md.
//
// Runnable standalone for its self-check: node plugins/oc-session-search/search.ts --self-check

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface SearchOptions {
	/** Words to look for, or a regular expression. */
	query: string
	/** Substring of the directory a session belongs to, e.g. "OpenCode". */
	project?: string
	/** Earliest date, YYYY-MM-DD, inclusive. */
	since?: string
	/** Latest date, YYYY-MM-DD, inclusive. */
	until?: string
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

/** One row of the scan: enough to rank and to name a session, without the message body. */
interface Candidate {
	rid: number
	sid: string
	title: string | null
	dir: string
	kind: string
	ts: number
	score: number
}

/** How a query is looked for: as words, or as the expression the caller wrote. */
type Plan = { kind: "regex"; source: string } | { kind: "terms"; terms: string[] }

/** Rows per statement: the stall the event loop sees is one chunk, not the whole scan. */
const CHUNK = 1_000
/** The count is capped so the scan stays bounded; the longest words are kept. */
const MAX_TERMS = 6
/** Messages whose JSON is read per round. */
const FIELD = 120
/** Rounds of `FIELD` bodies: the word-bounded test may reject a whole page of substring noise. */
const ROUNDS = 5
/** Beyond this many candidates the scan stops. */
const CANDIDATES = 30_000
const SNIPPET_BEFORE = 120
const SNIPPET_AFTER = 200

export function databasePath(): string {
	const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
	return process.env.OPENCODE_DB ?? join(data, "opencode", "opencode.db")
}

/** The words of a query, longest first. */
export function terms(query: string): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const word of (query.match(/[A-Za-z0-9_]{2,}/g) ?? []).sort((a, b) => b.length - a.length)) {
		const key = word.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		// Lowered with the stored text: `instr` is case-sensitive — the doc, Gotchas.
		out.push(key)
		if (out.length === MAX_TERMS) break
	}
	return out
}

/** A term and, for a plural, its singular. */
export function variants(term: string): string[] {
	return term.length >= 5 && /[^s]s$/i.test(term) ? [term, term.slice(0, -1)] : [term]
}

/** A query carrying regex syntax is run as one, unchanged; anything else is split into words. */
export function looksLikeRegex(query: string): boolean {
	return /[.*+?^$()[\]{}|\\]/.test(query)
}

/** Every literal run of an expression: SQL can only prefilter on those, and `a|b` needs both. */
export function literals(query: string): string[] {
	return [...new Set((query.match(/[A-Za-z0-9_]{2,}/g) ?? []).map((run) => run.toLowerCase()))]
}

/** JSON escapes turned back into text, so the match runs on prose and the snippet is readable. */
export function plain(data: string): string {
	return data
		.replace(/\\\\/g, "\u0000")
		.replace(/\\[nrt]/g, " ")
		.replace(/\\"/g, '"')
		.replace(/\u0000/g, "\\")
}

/** The prose of a message: `text`, or its text parts. */
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

/** A turn of the event loop. */
function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve))
}

function literal(text: string): string {
	return "'" + text.replace(/'/g, "''") + "'"
}

/** Local midnight, as SQLite stores it. `end` moves to the next day, so `until` includes its date. */
function day(date: string, end: boolean): number | null {
	const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!parts) return null
	const year = Number(parts[1])
	const month = Number(parts[2])
	const dayOfMonth = Number(parts[3])
	const start = new Date(year, month - 1, dayOfMonth)
	// A real date round-trips; the constructor turns 2025-02-30 into March without complaining.
	if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== dayOfMonth) return null
	return new Date(year, month - 1, dayOfMonth + (end ? 1 : 0)).getTime()
}

/** One connection for the whole search. `bun:sqlite` returns in a promise so both paths look alike. */
interface Store {
	query(sql: string): Promise<any[]>
	close(): void
}

/** The host's own SQLite, loaded once. */
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

async function openStore(database: string): Promise<Store> {
	const sqlite = await hostSqlite()
	if (sqlite) {
		try {
			const db = new sqlite.Database(database, { readonly: true })
			return {
				async query(sql: string) {
					return db.query(sql).all() as any[]
				},
				close: () => db.close(),
			}
		} catch {
			// A read-only open of a live WAL database is the one thing that can differ per host:
			// fall through to the CLI rather than lose the tool.
		}
	}
	return {
		query: (sql: string) =>
			new Promise((resolve, reject) => {
				execFile(
					"sqlite3",
					["file:" + database + "?mode=ro", "-json", sql],
					{ maxBuffer: 64 * 1024 * 1024 },
					(error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout || "[]"))),
				)
			}),
		close: () => {},
	}
}

/** One term, or one regex, as SQL: the rows that may match, and one presence column per term. */
function sqlFor(plan: Plan): { where: string; cols: string[] } {
	if (plan.kind === "regex") {
		const runs = literals(plan.source)
		return {
			// An expression with no literal run (`.`, `\d+`) has nothing to prefilter on: every row is
			// a candidate, and the cap below is what keeps that survivable. Both sides are lowered: `instr`
			// is case-sensitive on the stored text.
			where:
				runs.length === 0
					? "1 = 1"
					: runs.map((run) => "instr(lower(m.data), " + literal(run) + ") > 0").join(" or "),
			cols: [],
		}
	}
	const one = (term: string) =>
		variants(term)
			.map((variant) => "instr(lower(m.data), " + literal(variant) + ") > 0")
			.join(" or ")
	return {
		where: plan.terms.map((term) => "(" + one(term) + ")").join(" or "),
		cols: plan.terms.map((term, i) => "(" + one(term) + ") as t" + i),
	}
}

/** Every candidate, in chunks, scored by how many query words it holds. */
async function scan(store: Store, plan: Plan, options: SearchOptions): Promise<{
	candidates: Candidate[]
	sessions: number
	weights: number[]
	capped?: boolean
	stalled?: string
}> {
	const { where, cols } = sqlFor(plan)
	const bounds: string[] = []
	const since = options.since ? day(options.since, false) : undefined
	const until = options.until ? day(options.until, true) : undefined
	if (since === null || until === null)
		return { candidates: [], sessions: 0, weights: [], stalled: "Dates must be real dates, YYYY-MM-DD." }
	const low = through(since)
	const high = through(until)
	if (low && high && Number(low) >= Number(high))
		return { candidates: [], sessions: 0, weights: [], stalled: "`since` is after `until`." }
	if (low) bounds.push("m.time_created >= " + low)
	if (high) bounds.push("m.time_created < " + high)
	const project = options.project
		? "instr(lower(s.directory), " + literal(options.project.toLowerCase()) + ") > 0"
		: undefined

	const top = await store.query("select max(rowid) as top from session_message")
	const max = Number(top[0]?.top ?? 0)
	const candidates: Candidate[] = []
	let capped = false
	for (let lo = 0; lo < max; lo += CHUNK) {
		if (options.signal?.aborted) break
		const sql =
			"select m.rowid as rid, m.session_id as sid, s.title as title, s.directory as dir," +
			" m.type as kind, m.time_created as ts, " +
			(cols.length > 0 ? cols.join(", ") + ", " : "") +
			"0 as score from session_message m join session_v2 s on s.id = m.session_id" +
			" where m.rowid > " +
			lo +
			" and m.rowid <= " +
			(lo + CHUNK) +
			" and (" +
			where +
			")" +
			(bounds.length > 0 ? " and " + bounds.join(" and ") : "") +
			(project ? " and " + project : "")
		for (const row of await store.query(sql)) candidates.push(row as Candidate)
		if (candidates.length > CANDIDATES) {
			capped = true
			break
		}
		await tick()
	}
	// Weights from the scan's own candidate set, applied in place: no second pass over the corpus.
	const weights: number[] = plan.kind === "terms" ? plan.terms.map(() => 0) : []
	if (plan.kind === "terms") {
		const keys = plan.terms.map((_, i) => "t" + i)
		keys.forEach((key, i) => {
			const df = candidates.reduce((n, row: any) => n + (Number(row[key]) > 0 ? 1 : 0), 0)
			weights[i] = Math.log(1 + candidates.length / Math.max(df, 1))
		})
		for (const row of candidates as any[]) {
			row.score = keys.reduce((sum, key, i) => sum + (Number(row[key]) > 0 ? weights[i] : 0), 0)
		}
	}
	const sessions = new Set(candidates.map((c) => c.sid)).size
	return { candidates, sessions, weights, capped }
}

function through(value: number | null | undefined): string | undefined {
	return typeof value === "number" ? String(value) : undefined
}

/** The words of the query as word-bounded matchers: this is the precision pass. */
function judge(plan: Plan, weights: number[]): (text: string) => { matched: number; at: number } {
	if (plan.kind === "regex") {
		const source = plan.source
		return (text) => {
			try {
				const at = text.search(new RegExp(source, "i"))
				return { matched: at >= 0 ? 1 : 0, at }
			} catch {
				return { matched: 0, at: -1 }
			}
		}
	}
	const matchers = plan.terms.map((term) => {
		const word = variants(term)
			.map((variant) => variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|")
		return new RegExp("\\b(?:" + word + ")", "i")
	})
	return (text) => {
		let matched = 0
		let at = -1
		let weight = -1
		matchers.forEach((matcher, i) => {
			const found = text.search(matcher)
			if (found < 0) return
			matched++
			// Centre the snippet on the rarest word present, not the first match.
			if (weights[i] > weight) {
				weight = weights[i]
				at = found
			}
		})
		return { matched, at }
	}
}

export function hit(candidate: Candidate, index: number, source: string): SearchHit {
	const start = Math.max(0, index - SNIPPET_BEFORE)
	return {
		session: candidate.sid,
		title: candidate.title ?? "(untitled)",
		project: candidate.dir.split("/").pop() ?? candidate.dir,
		date: new Date(candidate.ts).toLocaleDateString("en-CA"),
		role: candidate.kind,
		snippet: source.slice(start, index + SNIPPET_AFTER).replace(/\s+/g, " ").trim(),
	}
}

export function format(hits: SearchHit[], query: string, sessions: number): string {
	if (hits.length === 0) return "No session match for /" + query + "/ (0 session(s) matched)."
	const header =
		hits.length +
		" hit(s) for /" +
		query +
		"/: " +
		sessions +
		" session(s) contain a match, best first. Snippet is raw transcript text; " +
		"read a whole session with `opencode api get /api/session/<id>/message`."
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
	const plan: Plan = looksLikeRegex(options.query)
		? { kind: "regex", source: options.query }
		: { kind: "terms", terms: terms(options.query) }
	if (plan.kind === "terms" && plan.terms.length === 0) {
		const text = "The query needs at least one word of two or more letters or digits."
		return { hits: [], sessions: 0, text }
	}
	if (plan.kind === "regex") {
		try {
			new RegExp(plan.source, "i")
		} catch (error) {
			const text = "Invalid regular expression: " + (error instanceof Error ? error.message : String(error))
			return { hits: [], sessions: 0, text }
		}
	}
	const database = options.database ?? databasePath()
	if (!existsSync(database)) {
		const text = "No session database at " + database + "."
		return { hits: [], sessions: 0, text }
	}

	const store = await openStore(database)
	try {
		const { candidates, weights, capped, stalled } = await scan(store, plan, options)
		if (stalled) return { hits: [], sessions: 0, text: stalled }
		// Ranked before anything is read or cut: score first, recency as the tiebreak.
		candidates.sort((a, b) => b.score - a.score || b.ts - a.ts)

		// Prose first, tool payloads only as filler: SQL cannot read the JSON and tell the two apart.
		const test = judge(plan, weights)
		const scored: Array<{ candidate: Candidate; prose: boolean; at: number; matched: number; source: string }> = []
		// Read on while the list is short: one page of substring noise can hide real matches.
		for (let taken = 0; taken < candidates.length && scored.length < limit && taken < FIELD * ROUNDS; taken += FIELD) {
			const field = candidates.slice(taken, taken + FIELD)
			if (field.length === 0) break
			const bodies = await store.query(
				"select m.rowid as rid, m.data as data from session_message m where m.rowid in (" +
					field.map((c) => c.rid).join(",") +
					")",
			)
			const byId = new Map<number, string>(bodies.map((row: any) => [Number(row.rid), String(row.data)]))
			for (const candidate of field) {
				const data = byId.get(candidate.rid)
				if (data === undefined) continue
				const prose = textOf(data)
				if (prose !== undefined) {
					const found = test(prose)
					if (found.matched > 0) {
						scored.push({ candidate, prose: true, at: found.at, matched: found.matched, source: prose })
						continue
					}
				}
				const raw = plain(data)
				const found = test(raw)
				if (found.matched > 0) {
					scored.push({ candidate, prose: false, at: found.at, matched: found.matched, source: raw })
				}
			}
			await tick()
		}
		// Prose first, then the weight the scan already computed, then date.
		scored.sort(
			(a, b) =>
				Number(b.prose) - Number(a.prose) || b.candidate.score - a.candidate.score || b.candidate.ts - a.candidate.ts,
		)

		const hits: SearchHit[] = []
		const perSession = new Map<string, number>()
		// One hit per session first, then the rest by rank with no cap: a long session that holds
		// every mention can still take the tail.
		const take = (cap: number) => {
			for (const entry of scored) {
				if (hits.length >= limit) return
				const count = perSession.get(entry.candidate.sid) ?? 0
				if (count >= cap) continue
				perSession.set(entry.candidate.sid, count + 1)
				hits.push(hit(entry.candidate, entry.at, entry.source))
			}
		}
		take(1)
		take(limit)
		// The header counts what was actually judged, not what the loose substring prefilter let through.
		const matched = new Set(scored.map((entry) => entry.candidate.sid)).size
		const note = capped
			? "\nStopped after " + CANDIDATES + " candidates: the ranking covers those only. Narrow the query or the dates."
			: ""
		return { hits, sessions: matched, text: format(hits, options.query, matched) + note }
	} finally {
		store.close()
	}
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
		if (filtered.hits.length === 0) throw new Error("self-check: the project filter found nothing")
		// The filter is a substring match on the directory, so its own subdirectories and siblings match too.
		if (filtered.hits.some((h) => !h.project.toLowerCase().includes("opencode")))
			throw new Error("self-check: project filter leaked")

		const bad = await searchSessions({ query: "([unclosed" })
		if (!/Invalid regular expression/.test(bad.text)) throw new Error("self-check: bad regex not reported")

		// Regression: a mixed-case query must still find the lowercase rows, and a lower-case query must
		// find a row where the word appears only capitalised — `instr` is case-sensitive on both sides.
		const mixed = await searchSessions({ query: "GitHub", limit: 2 })
		if (mixed.hits.length === 0) throw new Error("self-check: a capitalised query lost the lowercase rows")
		const sql = sqlFor({ kind: "terms", terms: terms("github") }).where
		if (!/instr\(lower\(m\.data\),/.test(sql))
			throw new Error("self-check: the prefilter does not lower the stored text")

		// Regression: a regex prefilter on one branch hides the others.
		const alternation = await searchSessions({ query: "pairing|ponytail", limit: 2 })
		if (alternation.hits.length === 0) throw new Error("self-check: an alternation lost its branches")

		// Regression: a word that lives across many sessions must not come back as one day only.
		const spread = await searchSessions({ query: "mirror github", limit: 10 })
		const days = new Set(spread.hits.map((h) => h.date))
		if (days.size < 2) throw new Error("self-check: ranking collapsed onto one day (" + [...days].join(",") + ")")

		// Regression: a sentence is words, not a phrase.
		const sentence = await searchSessions({ query: "budget panel blank overnight", limit: 5 })
		if (sentence.hits.length === 0) throw new Error("self-check: a multi-word query must not come back empty")

		// Regression: a period with no sessions is zero, stated, not an error and not "everything".
		const empty = await searchSessions({ query: "session", since: "2025-01-01", until: "2025-12-31" })
		if (empty.hits.length !== 0) throw new Error("self-check: a bounded past period must be empty")

		const wrongDate = await searchSessions({ query: "session", since: "01/01/2025" })
		if (!/YYYY-MM-DD/.test(wrongDate.text)) throw new Error("self-check: a malformed date must be reported")
		const impossible = await searchSessions({ query: "session", since: "2025-02-30" })
		if (!/real dates/.test(impossible.text)) throw new Error("self-check: an impossible date must be reported")
		const inverted = await searchSessions({ query: "session", since: "2026-06-01", until: "2026-05-01" })
		if (!/since.*is after/.test(inverted.text)) throw new Error("self-check: an inverted range must be reported")

		console.log(
			"self-check ok: " +
				probe.hits.length +
				" hits, " +
				spread.hits.length +
				" over " +
				days.size +
				" day(s), sample -> " +
				probe.hits[0].snippet.slice(0, 80),
		)
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
