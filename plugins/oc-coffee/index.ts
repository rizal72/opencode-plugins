// oc-coffee — server half.
//
// The level and the child live here, so both clients answer from one machine-wide fact; the terminal and
// the window only read and write it over `rpc.ts`. The record is `docs/oc-coffee.md`.
import { execFileSync, spawn, type ChildProcess } from "node:child_process"

import { Plugin } from "@opencode/plugin"

import { Coffee, FLAGS, isLevel, type CoffeeSnapshot, type Level } from "./rpc.ts"

const KEY = "coffee.level"
const DEFAULT: Level = "display"

/** The process-wide state. A symbol, so no other plugin's key can collide with ours. */
const MACHINE = Symbol.for("oc-coffee.machine")

/** The run's edges, and the signs of life inside one. */
const WATCHED = [
	"session.step.started",
	"session.step.ended",
	"session.tool.called",
	"session.tool.success",
	"session.execution.started",
	"session.execution.succeeded",
	"session.execution.failed",
	"session.execution.interrupted",
	"session.deleted",
	"session.archived",
] as const

interface Machine {
	readonly snapshot: () => CoffeeSnapshot
	readonly setLevel: (next: Level) => Promise<CoffeeSnapshot>
	/** What the host reported still running when a session last went idle, replacing that session's entry. */
	readonly setBackground: (sessionID: string, shells: readonly string[]) => void
}

const machine = (ctx: any): Promise<Machine> => ((globalThis as any)[MACHINE] ??= start(ctx))

async function start(ctx: any): Promise<Machine> {
	// macOS only: skipped rather than failed, so the plugin stays loaded elsewhere.
	const supported = process.platform === "darwin"

	// Reaped before any spawn: an orphan is ours by construction, its `-w` is this process.
	try {
		const suffix = `-w ${process.pid}`
		const table = execFileSync("ps", ["-A", "-o", "pid=", "-o", "command="], { encoding: "utf8" })
		for (const line of table.split("\n")) {
			const match = /^\s*(\d+)\s+caffeinate\b.*\s-w\s+\d+\s*$/.exec(line)
			if (!match || !line.trimEnd().endsWith(suffix)) continue
			try {
				process.kill(Number(match[1]), "SIGTERM")
			} catch {}
		}
	} catch {}

	let level: Level = DEFAULT
	const stored = await ctx.storage.get(KEY).catch(() => undefined)
	if (isLevel(stored)) level = stored

	const running = new Set<string>()
	/** Shells each session reported running at its last idle. */
	const shells = new Map<string, Set<string>>()
	let child: ChildProcess | undefined
	/** The level the live child was spawned with, so a change can be told from a no-op. */
	let childLevel: Level | undefined

	const stop = () => {
		const held = child
		child = undefined
		childLevel = undefined
		held?.kill("SIGTERM")
	}

	/** Turns in flight plus the commands they left behind. */
	const inFlight = () => running.size + [...shells.values()].reduce((total, ids) => total + ids.size, 0)

	// The assertion is up exactly while there is work and the level asks for it.
	const apply = () => {
		const wanted = supported && level !== "off" && inFlight() > 0
		if (wanted && child && childLevel !== level) stop()
		if (wanted && !child) {
			const spawned = spawn("caffeinate", [...FLAGS[level as Exclude<Level, "off">], "-w", String(process.pid)], {
				stdio: "ignore",
			})
			child = spawned
			childLevel = level
			spawned.on("error", () => {
				if (child === spawned) stop()
			})
			spawned.on("exit", () => {
				if (child === spawned) stop()
			})
		}
		if (!wanted && child) stop()
	}

	const snapshot = (): CoffeeSnapshot => ({ level, running: inFlight(), held: !!child })

	// Resubscribing with a backoff: a stream can end while the process lives, and a silent stop is worse
	// than a gap.
	void (async () => {
		let wait = 1_000
		for (;;) {
			try {
				for await (const event of ctx.event.subscribe({ types: [...WATCHED] })) {
					wait = 1_000
					const data = (event as any).data ?? {}
					const id = String(data.sessionID ?? "")
					const opened = event.type === "session.step.started" || event.type === "session.execution.started"
					// A session that is gone can never report again, so its shells go with it.
					const gone = event.type === "session.deleted" || event.type === "session.archived"
					const closed =
						event.type === "session.execution.succeeded" ||
						event.type === "session.execution.failed" ||
						event.type === "session.execution.interrupted" ||
						gone ||
						(event.type === "session.step.ended" && String(data.finish ?? "") !== "tool-calls")
					if (opened && id) running.add(id)
					else if (closed && id) running.delete(id)
					if (gone && id) shells.delete(id)
					apply()
				}
			} catch (error) {
				console.warn("oc-coffee: the event stream ended, resubscribing —", error instanceof Error ? error.message : error)
			}
			// The set survives a resubscribe: over-holding is the safe direction for a keep-awake.
			apply()
			await new Promise((resolve) => setTimeout(resolve, wait))
			wait = Math.min(wait * 2, 30_000)
		}
	})()

	return {
		snapshot,
		setBackground: (sessionID: string, ids: readonly string[]) => {
			if (!sessionID) return
			if (ids.length) shells.set(sessionID, new Set(ids))
			else shells.delete(sessionID)
			apply()
		},
		setLevel: async (next: Level) => {
			// Persisted first: a rejected write must leave the level it found, with no child moved.
			await ctx.storage.set(KEY, next)
			level = next
			apply()
			return snapshot()
		},
	}
}

export default Plugin.define({
	id: "oc-coffee",
	async setup(ctx) {
		const coffee = await machine(ctx)

		await ctx.rpc.register(Coffee, {
			snapshot: async (): Promise<CoffeeSnapshot> => coffee.snapshot(),
			set: async (input: any) => {
				if (!isLevel(input?.level)) throw new Error(`unknown coffee level: ${String(input?.level)}`)
				return coffee.setLevel(input.level)
			},
		})
		// The host's own answer to "what is still running", filed per session.
		//
		// `setBackground` is checked because a reload replaces this setup and not the machine.
		let stale = false
		await ctx.session.hook("experimental.idle", (input: any) => {
			if (typeof (coffee as any).setBackground !== "function") {
				if (!stale) console.warn("oc-coffee: this server predates the background report; restart it")
				stale = true
				return
			}
			const sessionID = String(input?.sessionID ?? "")
			const background = Array.isArray(input?.background) ? input.background : []
			const ids = background
				.filter((job: any) => job?.kind === "shell" && String(job?.sessionID ?? "") === sessionID)
				.map((job: any) => String(job?.shellID ?? ""))
				.filter(Boolean)
			coffee.setBackground(sessionID, ids)
		})
		// No cleanup: the machine belongs to the process, not to a location.
	},
})
