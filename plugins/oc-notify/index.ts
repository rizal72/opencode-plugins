// oc-notify — server half.
//
// When a turn ends and you are not at the Mac, the phone should buzz. Every fact behind that — which hook,
// which channel, how absence is measured, why the topic is a password — is stated in `docs/oc-notify.md`.
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Plugin } from "@opencode/plugin"

import { Notify, TOPIC, isMode, type Mode, type Snapshot } from "./rpc.ts"

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const CONFIG = join(CONFIG_DIR, "opencode", "oc-notify.json")

const TIMEOUT_MS = 5_000
/** One push per session per window: the idle hook runs again right after a background job ends. */
const QUIET_MS = 30_000

/** The process-wide state, behind a symbol so no other plugin's key can collide with ours, and shared by
 *  every loaded instance on purpose. */
const MACHINE = Symbol.for("oc-notify.machine")

interface Machine {
	/** sessionID -> ms of the last push. */
	readonly sent: Map<string, number>
	/** sessionID -> idle seconds when its last prompt was admitted. */
	readonly idleAtStart: Map<string, number>
	/** The last config that parsed, so a half-edited file falls back instead of going silent. */
	last?: Config
}

interface Config {
	mode?: string
	awayAfter?: number
	includeTitle?: boolean
	server?: string
	topic?: string
	/** The file on disk did not parse: the settings are the last good ones, and the body says so. */
	broken?: boolean
}

/** Read fresh on every call: the file is the only state. */
async function settings(machine: Machine): Promise<Config | undefined> {
	let raw: string
	try {
		raw = await readFile(CONFIG, "utf8")
	} catch {
		// No file, no channel: silence here is the switch, not an error.
		return undefined
	}
	try {
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== "object") throw new Error("not an object")
		return (machine.last = parsed as Config)
	} catch {
		// A broken file is the one failure that would otherwise look like "the agent is still working": keep
		// the last good settings and mark the body, rather than go silent.
		return machine.last ? { ...machine.last, broken: true } : undefined
	}
}

/** The configuration as both surfaces read it: the file's defaults where it says nothing. */
function shown(config: Config | undefined): Snapshot {
	const raw = config ?? {}
	const awayAfter = Number(raw.awayAfter)
	return {
		mode: isMode(raw.mode) ? raw.mode : "always",
		awayAfter: Number.isFinite(awayAfter) && awayAfter >= 0 ? awayAfter : 5,
		includeTitle: raw.includeTitle === true,
		topic: String(raw.topic ?? ""),
		broken: raw.broken === true,
	}
}

/** The one write path: validated here, because any client of the rpc can call it, and written whole and
 *  atomically so the key the page never sees — `server` — survives and no half-written file can appear. */
async function save(machine: Machine, input: any): Promise<Snapshot> {
	if (!isMode(input?.mode)) throw new Error(`unknown mode: ${String(input?.mode)}`)
	const awayAfter = Number(input?.awayAfter)
	if (!Number.isFinite(awayAfter) || awayAfter < 0) throw new Error("awayAfter must be a number of minutes")
	const topic = String(input?.topic ?? "")
	if (!topic) throw new Error("a topic is required: subscribe to it in the ntfy app")
	if (!TOPIC.test(topic)) throw new Error("a topic is letters, digits, `-` or `_`, up to 64 characters")

	// From the file, not from what this process happens to remember: a `set` can be the first call after a
	// restart, with the page still open, and `server` has to survive that as much as the page's own keys do.
	const known: Config = { ...((await settings(machine)) ?? {}) }
	delete known.broken
	const next: Config = { ...known, mode: input.mode as Mode, awayAfter, includeTitle: input?.includeTitle === true, topic }
	try {
		await mkdir(dirname(CONFIG), { recursive: true })
		await writeFile(`${CONFIG}.tmp`, `${JSON.stringify(next, null, "\t")}\n`)
		await rename(`${CONFIG}.tmp`, CONFIG)
	} catch (error) {
		throw new Error(`could not write ${CONFIG}: ${error instanceof Error ? error.message : String(error)}`)
	}
	return shown((machine.last = next))
}

/** Seconds since the last user input on this Mac, or `undefined` where `ioreg` is missing — which the away
 *  mode reads as "away". */
function idleSeconds(): number | undefined {
	if (process.platform !== "darwin") return undefined
	try {
		const table = execFileSync("ioreg", ["-c", "IOHIDSystem"], { encoding: "utf8", timeout: 2_000 })
		const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(table)
		return match ? Number(match[1]) / 1e9 : undefined
	} catch {
		return undefined
	}
}

/** One notification: the title names the session, the body names the agent and the time, and nothing the
 *  turn had not already put on screen leaves. */
async function send(config: Config, session: any): Promise<void> {
	const title = (config.includeTitle ? String(session?.title ?? "") : "") || "OpenCode"
	const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
	const agent = String(session?.agent ?? "")
	const message = agent ? `finished ${at} · ${agent}` : `finished ${at}`
	const text = config.broken ? `${message} — config error` : message

	const base = String(config.server || "https://ntfy.sh").replace(/\/+$/, "")
	const response = await fetch(base, {
		method: "POST",
		headers: { "Content-Type": "application/json", "User-Agent": "oc-notify/0.1" },
		body: JSON.stringify({ topic: config.topic, title, message: text }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export default Plugin.define({
	id: "oc-notify",
	async setup(context: any) {
		const machine: Machine = ((globalThis as any)[MACHINE] ??= { sent: new Map(), idleAtStart: new Map() })

		// The page, and later the terminal command, read and write through here, so neither knows the file's
		// path or its shape.
		await context.rpc.register(Notify, {
			get: async (): Promise<Snapshot> => shown(await settings(machine)),
			set: async (input: any): Promise<Snapshot> => save(machine, input),
		})

		// Where you were when the turn started: a prompt typed on the phone arrives while the Mac is idle.
		const admitted = await context.session.hook("prompt", (input: any) => {
			const sessionID = String(input?.sessionID ?? "")
			const idle = idleSeconds()
			if (!sessionID || idle === undefined) return
			machine.idleAtStart.set(sessionID, idle)
		})

		const finished = await context.session.hook("experimental.idle", async (input: any) => {
			try {
				const sessionID = String(input?.sessionID ?? "")
				if (!sessionID) return

				const config = await settings(machine)
				if (!config || config.mode === "off" || !config.topic || !TOPIC.test(config.topic)) return

				// Work still owned by this session: the hook runs again when it ends, so a push now would
				// announce a turn that has not finished.
				const background = Array.isArray(input?.background) ? input.background : []
				if (background.some((job: any) => String(job?.sessionID ?? "") === sessionID)) return

				if (config.mode === "away") {
					// The rule `shown()` applies, so a hand-edited "5 minutes" cannot make the mode silent.
					const minutes = Number(config.awayAfter)
					const wait = (Number.isFinite(minutes) && minutes >= 0 ? minutes : 5) * 60
					const start = machine.idleAtStart.get(sessionID)
					const end = idleSeconds()
					if (!(start !== undefined && start >= wait) && !(end === undefined || end >= wait)) return
				}

				// The check and the claim are contiguous — no `await` between them: every open location loads
				// this plugin, and a gap would let two instances through.
				const now = Date.now()
				if (now - (machine.sent.get(sessionID) ?? 0) < QUIET_MS) return
				machine.sent.set(sessionID, now)

				const session = await context.session.get({ sessionID }).catch(() => undefined)
				// A child session's work is reported by its parent's hook, not by a push of its own.
				if (!session || session.parentID) return

				try {
					await send(config, session)
				} catch (error) {
					// Released: a delivery that failed must not silence the next real turn of this session.
					machine.sent.delete(sessionID)
					throw error
				}
			} catch (error) {
				// Never the turn's problem: a push that fails is a missed buzz, not a broken session.
				console.error(`[oc-notify] ${error instanceof Error ? error.message : String(error)}`)
			}
		})

		return async () => {
			await admitted.dispose()
			await finished.dispose()
		}
	},
})
