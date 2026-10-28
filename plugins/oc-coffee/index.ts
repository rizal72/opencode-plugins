// oc-coffee — server half.
//
// The level and the assertion are one fact for the whole machine, so they live here: the server is the
// single process every client talks to, it survives them, and it is the one that runs the turns. The
// terminal and the window only read and write it over `rpc.ts`.
//
// **One process, one child.** The loader instantiates this plugin once per location — two open projects
// mean two instances, and they do not share module scope — so the state cannot live in this closure: it
// lives on the process, behind a symbol. The first instance to load starts it, every other instance
// answers from it, and both clients get the same answer wherever they are.
//
// Counting is over **all** sessions: the assertion is machine-wide, so one session finishing must not
// put the Mac back to sleep while another works. Subagents count too, because their work is work.
//
// The child is `caffeinate … -w <pid>`, bound to this process: if the server dies the work dies with
// it, so an assertion falling with it says the truth and needs no cleanup. A level change mid-run
// respawns the child with the new flags, which is exactly when it is wanted.
import { execFileSync, spawn, type ChildProcess } from "node:child_process"

import { Plugin } from "@opencode/plugin"

import { Coffee, FLAGS, isLevel, type CoffeeSnapshot, type Level } from "./rpc.ts"

const KEY = "coffee.level"
const DEFAULT: Level = "display"

/** The process-wide state. A symbol, so no other plugin's key can collide with ours. */
const MACHINE = Symbol.for("oc-coffee.machine")

/** The run's edges, and the signs of life inside one. The host renamed these once — `execution.*` became
 *  `step.*` plus the tool events — so both shapes are watched: the cup is a view of "the agent is
 *  working", and the names of the events that say it have already changed once. */
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

/** A step ends before its tools run and the next one starts after them, so the turn is not a step: it is
 *  open from the first step to the step that finishes with anything but `tool-calls`. Nothing here is
 *  timed, which is what lets a command run for a minute without the cup dropping under it. */

interface Machine {
	readonly snapshot: () => CoffeeSnapshot
	readonly setLevel: (next: Level) => Promise<CoffeeSnapshot>
}

const machine = (ctx: any): Promise<Machine> => ((globalThis as any)[MACHINE] ??= start(ctx))

async function start(ctx: any): Promise<Machine> {
	// macOS only: `caffeinate` is not on the PATH elsewhere, so the spawn is skipped rather than failed.
	const supported = process.platform === "darwin"

	// `-w` binds the child to the server, and the server outlives the plugin — so a child from a plugin
	// that is gone is still there, holding the assertion with flags nothing will ever change. Reaped
	// before any spawn: an orphan is ours by construction, its `-w` is this process.
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
	let child: ChildProcess | undefined
	/** The level the live child was spawned with, so a change can be told from a no-op. */
	let childLevel: Level | undefined

	const stop = () => {
		const held = child
		child = undefined
		childLevel = undefined
		held?.kill("SIGTERM")
	}

	// The assertion is up exactly while there is work and the level asks for it.
	const apply = () => {
		const wanted = supported && level !== "off" && running.size > 0
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

	const snapshot = (): CoffeeSnapshot => ({ level, running: running.size, held: !!child })

	// A stream can end while the process lives: one hiccup used to stop the cup until the next restart, and
	// it did so silently. So this is a loop that always comes back, with a backoff so a subscription that
	// cannot open at all cannot spin either.
	void (async () => {
		let wait = 1_000
		for (;;) {
			try {
				for await (const event of ctx.event.subscribe({ types: [...WATCHED] })) {
					wait = 1_000
					const data = (event as any).data ?? {}
					const id = String(data.sessionID ?? "")
					const opened = event.type === "session.step.started" || event.type === "session.execution.started"
					const closed =
						event.type === "session.execution.succeeded" ||
						event.type === "session.execution.failed" ||
						event.type === "session.execution.interrupted" ||
						event.type === "session.deleted" ||
						event.type === "session.archived" ||
						(event.type === "session.step.ended" && String(data.finish ?? "") !== "tool-calls")
					if (opened && id) running.add(id)
					else if (closed && id) running.delete(id)
					apply()
				}
			} catch (error) {
				console.warn("oc-coffee: the event stream ended, resubscribing —", error instanceof Error ? error.message : error)
			}
			// The set survives a resubscribe on purpose: a stream that hiccups mid-run must not release
			// the assertion, and over-holding is the safe direction for a keep-awake. A session that really
			// ended still clears itself on its own `execution.*` event.
			apply()
			await new Promise((resolve) => setTimeout(resolve, wait))
			wait = Math.min(wait * 2, 30_000)
		}
	})()

	return {
		snapshot,
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
		// No cleanup: the machine belongs to the process, not to a location. Disabling the plugin leaves
		// the child until the server restarts, which is the price of one assertion for one machine.
	},
})
