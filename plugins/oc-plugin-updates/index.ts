// oc-plugin-updates — server half.
//
// V2 checks unpinned package plugins at startup and never applies an update: `opencode plugin check`
// reports, `opencode plugin update` is a gesture the user has to know exists. Nothing in the window says a
// plugin is behind, which is how a machine runs one three versions old without a hint.
//
// The two routes exist on the server — `POST /api/plugin/check`, `POST /api/plugin/update` — and `update`
// answers once it has told the active locations to reload, so applying one needs no restart. What a plugin
// is not given is a client for the server's own routes (`ctx.plugin` carries `list` alone), so the call
// goes out through the CLI, which is the one client that knows how the local server authenticates.
import { Plugin } from "@opencode/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { Updates, type CheckResult, type UpdateResult, type UpdateRow } from "./rpc.ts"

const exec = promisify(execFile)

/** The list changes when a package is published, not on a clock: six hours, and one read per session. */
const TTL_MS = 6 * 60 * 60 * 1000
/** A check is one CLI round trip: generous, because a cold cache pays for a version lookup. */
const CHECK_TIMEOUT_MS = 60_000
/** N packages, one install each; the guard only has to outlast a whole update, not a prompt. */
const UPDATE_TIMEOUT_MS = 180_000
const KEY = "check"

/**
 * shortcut: on a healthy machine two of this plugin's four states cannot be reached — a failed check and a
 * failed update — so the dev switch fakes them and is inert unless the variable is set. Upgrade when the
 * app grows a way to point a read at a package list of its own.
 */
const DEV = process.env.OC_PLUGIN_UPDATES_DEV ?? ""

const FAKE: UpdateRow[] = [
	{ id: "oc-git", target: "@rizal72/oc-git", version: "0.2.0" },
	{ id: "github-panel", target: "opencode-github-panel", version: "0.1.0" },
]

/**
 * `process.execPath` is the opencode binary when the service runs compiled, and PATH covers a server
 * started another way. The winner is remembered; a binary that is not there falls through to the next.
 */
const CANDIDATES = [process.env.OC_PLUGIN_UPDATES_BIN, process.execPath, "opencode"].filter(
	(value): value is string => !!value,
)
let binary: string | undefined
/** One update at a time for the whole server; see the `update` handler. */
let running = false

/** The first line of whatever went wrong, and the server's own message when it sent one. */
function message(error: unknown): string {
	const value = error as { stdout?: string; stderr?: string; message?: string }
	const out = value?.stdout?.trim()
	if (out) {
		try {
			const parsed = JSON.parse(out)
			if (typeof parsed?.message === "string") return parsed.message
		} catch {}
	}
	const text = value?.stderr?.trim() || value?.message || String(error)
	return text.split("\n")[0] ?? ""
}

async function api(path: string, body: unknown, timeout: number): Promise<unknown> {
	let failure = ""
	// The remembered binary first, then the rest: a binary that vanished must fall through, not truncate.
	const order = binary ? [binary, ...CANDIDATES.filter((candidate) => candidate !== binary)] : CANDIDATES
	for (const candidate of order) {
		try {
			const { stdout } = await exec(candidate, ["api", "post", path, "-d", JSON.stringify(body)], {
				timeout,
				maxBuffer: 8 * 1024 * 1024,
			})
			binary = candidate
			const text = stdout.trim()
			return text ? JSON.parse(text) : undefined
		} catch (error) {
			const code = (error as { code?: string })?.code
			// A binary that is not there is worth the next candidate; a call that failed is the answer.
			if (code === "ENOENT") {
				if (binary === candidate) binary = undefined
				failure = `no opencode binary: ${candidate}`
				continue
			}
			throw new Error(message(error))
		}
	}
	throw new Error(failure || "no opencode binary")
}

/** The cache travels as JSON text: `ctx.storage` holds `Schema.Json`, and a list of objects is not one. */
type Held = { at: number; rows: UpdateRow[]; dev?: string }

function held(raw: unknown): Held | undefined {
	if (typeof raw !== "string") return undefined
	try {
		const value = JSON.parse(raw)
		if (typeof value?.at !== "number" || !Number.isFinite(value.at) || !Array.isArray(value.rows)) return undefined
		const rows: UpdateRow[] = []
		for (const row of value.rows) {
			// A row that does not pass the contract turns every check into a 500 until the TTL expires, and
			// blames the read for a bad cache byte: a cache we cannot read is a cache we drop.
			if (typeof row?.target !== "string" || !row.target) return undefined
			rows.push({
				target: row.target,
				...(typeof row.id === "string" ? { id: row.id } : {}),
				...(typeof row.version === "string" ? { version: row.version } : {}),
			})
		}
		// A clock that jumped backwards must not make a reading fresh for ever.
		return { at: Math.min(Math.max(value.at, 0), Date.now()), rows, ...(typeof value.dev === "string" ? { dev: value.dev } : {}) }
	} catch {
		return undefined
	}
}

/** The installed plugins that have a newer version published. Local and built-in ones never do. */
async function read(): Promise<CheckResult> {
	if (DEV === "outdated" || DEV === "fail") return { ok: true, at: Date.now(), rows: FAKE }
	const payload = (await api("/api/plugin/check", { target: null }, CHECK_TIMEOUT_MS)) as {
		data?: { id?: string; source?: Record<string, unknown> }[]
	}
	const rows: UpdateRow[] = []
	for (const plugin of payload?.data ?? []) {
		const source = plugin?.source
		if (source?.type !== "package" || source.outdated !== true) continue
		if (typeof source.target !== "string") continue
		// `undefined` is not a string for the output validator: a key that is absent is the only way to say
		// "not there" (`plugins/oc-git/index.ts` learned this the same way).
		rows.push({
			target: source.target,
			...(plugin.id ? { id: plugin.id } : {}),
			...(typeof source.version === "string" ? { version: source.version } : {}),
		})
	}
	return { ok: true, at: Date.now(), rows }
}

export default Plugin.define({
	id: "oc-plugin-updates",
	async setup(ctx) {
		await ctx.rpc.register(Updates, {
			check: async (input: any): Promise<CheckResult> => {
				const cached = input?.force === true ? undefined : held(await ctx.storage.get(KEY))
				// A reading taken under a test switch dies with the switch: the cache outlives the server, so
				// otherwise the fake rows would be served for six hours after the variable is gone.
				if (cached && cached.dev === DEV && Date.now() - cached.at < TTL_MS)
					return { ok: true, at: cached.at, rows: cached.rows }
				try {
					const result = await read()
					// Best effort: a cache we cannot write is a slow next read, not a failed one.
					await ctx.storage
						.set(KEY, JSON.stringify({ at: result.at ?? Date.now(), rows: result.rows ?? [], dev: DEV }))
						.catch(() => {})
					return result
				} catch (error) {
					// The last good reading is still worth showing: the pill marks it as held instead of
					// hiding, because a hidden pill is the refusal to say anything at all. A reading taken
					// under a test switch is not "good" once the switch is gone.
					const last = held(await ctx.storage.get(KEY))
					return { ok: false, error: message(error), ...(last && last.dev === DEV ? { at: last.at, rows: last.rows } : {}) }
				}
			},
			update: async (input: any): Promise<UpdateResult> => {
				const targets = Array.isArray(input?.targets) ? input.targets.map(String).filter(Boolean) : []
				if (!targets.length) return { ok: true }
				// One update at a time for the whole server. The halves guard their own rows, and that guard
				// covers one window: a second window, the terminal, or a client whose 180 s expired would
				// still reach us, and two installs of the same packages race.
				if (running) return { ok: false, busy: true, error: "an update is already running" }
				running = true
				try {
					if (DEV === "fail") throw new Error("simulated failure (OC_PLUGIN_UPDATES_DEV=fail)")
					if (DEV === "slow") await new Promise((resolve) => setTimeout(resolve, 15_000))
					else if (!DEV) await api("/api/plugin/update", { targets }, UPDATE_TIMEOUT_MS)
					// The next read must not reuse a list that is no longer true. The reload usually restarts
					// this plugin anyway; this covers the location the server did not reload.
					await ctx.storage.remove(KEY).catch(() => {})
					return { ok: true }
				} catch (error) {
					return { ok: false, error: message(error) }
				} finally {
					running = false
				}
			},
		})
	},
})
