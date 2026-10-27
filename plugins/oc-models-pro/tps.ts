// oc-models-pro/tps.ts — tokens per second, measured on this machine.
//
// Not an estimate from a catalogue: it is what this provider actually did, for the models this
// person actually ran. The number is the one the industry publishes, so it can be read next to
// anything online: (output + reasoning tokens) over the window from the first streamed token to the
// last, time-to-first-token excluded — Artificial Analysis' "output speed", and `completion_tokens`
// as OpenAI, Anthropic and OpenRouter bill it, where reasoning is part of the output.
//
// The window is the last seven days when it holds at least three turns, and all of history when it
// does not: a number from a provider's good week is worth less than the provider's behaviour now,
// but an empty cell for a model used once last month is worth less still.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/tps.ts --self-check

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Speed {
	/** Median tokens per second for this provider/model. */
	tps: number
	/** How many turns the median came from. */
	samples: number
	/** True when the seven-day window was too thin and the whole history was used. */
	allTime: boolean
}

interface Turn {
	key: string
	sid: string
	tps: number
	at: number
}

/** A window thinner than this is noise, not a measurement. */
const RECENT_DAYS = 7
const MIN_SAMPLES = 3
/** A turn shorter than this cannot separate decode time from the rounding of the clock. */
const MIN_SPAN_MS = 200
const MIN_TOKENS = 20

export function databasePath(): string {
	const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
	return process.env.OPENCODE_DB || join(data, "opencode", "opencode.db")
}

/** The host's own SQLite. Absent outside Bun, where the CLI carries the self-check. */
async function sqlite(): Promise<typeof import("bun:sqlite") | undefined> {
	try {
		return await import("bun:sqlite")
	} catch {
		return undefined
	}
}

async function read(database: string): Promise<Array<{ data: string; at: number; sid: string }>> {
	if (!existsSync(database)) return []
	const bun = await sqlite()
	if (bun) {
		try {
			const db = new bun.Database(database, { readonly: true })
			try {
				return db
					.query("select data, time_created as at, session_id as sid from session_message where type = 'assistant'")
					.all() as Array<{ data: string; at: number; sid: string }>
			} finally {
				db.close()
			}
		} catch {
			// A read-only open of a live WAL database is the one thing that differs per host.
		}
	}
	return new Promise((resolve, reject) => {
		execFile(
			"sqlite3",
			[
				"file:" + database + "?mode=ro",
				"-json",
				"select data, time_created as at, session_id as sid from session_message where type = 'assistant'",
			],
			{ maxBuffer: 256 * 1024 * 1024 },
			(error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout || "[]"))),
		)
	})
}

/** One assistant turn as a rate, or nothing when the clock or the token counts cannot carry one. */
export function turn(entry: any, sid = ""): Turn | undefined {
	if (!entry || !entry.tokens || !entry.time || !Array.isArray(entry.content)) return undefined
	const provider = entry.model?.providerID
	const model = entry.model?.id
	if (typeof provider !== "string" || typeof model !== "string") return undefined
	// The window opens at the first content part that carries a timestamp — a part without one (a file
	// reference, say) would start the clock late and overstate the rate.
	const first = entry.content.find((part: any) => typeof part?.time?.created === "number")?.time?.created
	// The last streamed token; `completed` only when the host recorded nothing (it carries the same
	// instant, and post-stream bookkeeping would drag the rate down).
	const last = entry.time.streamed ?? entry.time.completed
	if (typeof first !== "number" || typeof last !== "number") return undefined
	const tokens = (entry.tokens.output ?? 0) + (entry.tokens.reasoning ?? 0)
	const span = last - first
	if (!(span >= MIN_SPAN_MS) || tokens < MIN_TOKENS) return undefined
	return { key: provider + "/" + model, sid, tps: tokens / (span / 1000), at: entry.time.created ?? 0 }
}

export function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const middle = sorted.length >> 1
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** The rates of every model, keyed `providerID/modelID` as the host writes them. */
export async function speedIndex(database = databasePath()): Promise<{
	speeds: Map<string, Speed>
	turns: number
	rows: number
}> {
	let rows: Array<{ data: string; at: number; sid: string }>
	try {
		rows = await read(database)
	} catch {
		return { speeds: new Map(), turns: 0, rows: 0 }
	}
	const turns: Turn[] = []
	for (const row of rows) {
		let entry: any
		try {
			entry = JSON.parse(row.data)
		} catch {
			continue
		}
		const measured = turn(entry, row.sid)
		if (measured) turns.push({ ...measured, at: measured.at || row.at })
	}

	const since = Date.now() - RECENT_DAYS * 86_400_000
	const speeds = new Map<string, Speed>()
	for (const key of new Set(turns.map((t) => t.key))) {
		const all = turns.filter((t) => t.key === key)
		const recent = all.filter((t) => t.at >= since)
		const use = recent.length >= MIN_SAMPLES ? recent : all
		if (use.length === 0) continue
		// One voice per session, then the median of those voices: without it a single long-running
		// session elects the number on its own, and this person's sessions run for days.
		const perSession = new Map<string, number[]>()
		for (const t of use) {
			const list = perSession.get(t.sid) ?? []
			list.push(t.tps)
			perSession.set(t.sid, list)
		}
		speeds.set(key, {
			tps: median([...perSession.values()].map((list) => median(list))),
			samples: use.length,
			allTime: recent.length < MIN_SAMPLES,
		})
	}
	return { speeds, turns: turns.length, rows: rows.length }
}

// Self-check: node plugins/oc-models-pro/tps.ts --self-check
if (process.argv[2] === "--self-check") {
	const run = async () => {
		const started = Date.now()
		const { speeds, turns, rows } = await speedIndex()
		const ms = Date.now() - started

		// The thresholds and the key, on turns made up here: real data cannot exercise a floor it never hits.
		const base = {
			model: { providerID: "p", id: "m" },
			time: { created: 0, streamed: 1000 },
			tokens: { output: 30, reasoning: 20 },
			content: [{ type: "text", time: { created: 200 } }],
		}
		const good = turn(base, "ses_x")
		if (!good || good.key !== "p/m" || good.sid !== "ses_x") throw new Error("self-check: a plain turn did not parse")
		if (Math.abs(good.tps - 62.5) > 0.001) throw new Error("self-check: 50 tokens over 800 ms is not 62.5 t/s: " + good.tps)
		const short = { ...base, time: { created: 0, streamed: 300 } }
		if (turn(short)) throw new Error("self-check: a 100 ms window must be dropped")
		const few = { ...base, tokens: { output: 5, reasoning: 0 } }
		if (turn(few)) throw new Error("self-check: five tokens must be dropped")
		if (turn({ time: {}, tokens: {}, content: [] })) throw new Error("self-check: a turn without a model must be dropped")
		if (median([3, 1, 2]) !== 2 || median([1, 4]) !== 2.5) throw new Error("self-check: median is wrong")

		if (rows === 0) {
			console.log("self-check ok: no assistant messages on this machine, nothing to measure")
			return
		}
		// Rows but no measurement is not an empty machine: it is a shape that moved, and it must fail.
		if (turns === 0) throw new Error("self-check: " + rows + " assistant messages and none measurable, the message shape changed")
		if (speeds.size === 0) throw new Error("self-check: " + turns + " turns but no model measured")
		for (const [key, speed] of speeds) {
			if (!Number.isFinite(speed.tps) || speed.tps <= 0) throw new Error("self-check: " + key + " not finite: " + speed.tps)
			if (speed.samples < 1) throw new Error("self-check: " + key + " has no samples")
		}
		const best = [...speeds.entries()].sort((a, b) => b[1].samples - a[1].samples).slice(0, 3)
		console.log(
			"self-check ok: " +
				turns +
				" turns, " +
				speeds.size +
				" models, " +
				ms +
				" ms -> " +
				best.map(([k, s]) => k + " " + s.tps.toFixed(1) + " t/s (" + s.samples + (s.allTime ? " all-time" : " 7d") + ")").join(", "),
		)
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
