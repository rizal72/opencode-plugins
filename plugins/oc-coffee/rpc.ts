// The contract both clients read: the level is one fact for the machine, so the server owns it and
// neither the terminal nor the window ever keeps a copy of its own.
import { Rpc } from "@opencode/plugin/rpc"

export const LEVELS = ["off", "idle", "display", "system"] as const

export type Level = (typeof LEVELS)[number]

export const isLevel = (value: unknown): value is Level => LEVELS.includes(value as Level)

/** The `caffeinate` flags each level means. One table: the server spawns from it, the clients print it. */
export const FLAGS: Record<Level, readonly string[]> = {
	off: [],
	idle: ["-i"],
	display: ["-i", "-d"],
	system: ["-i", "-d", "-s", "-u"],
}

/** The row's `detail`, and the command's report: the flags as they are run, or none at all. */
export const flagsText = (level: Level): string =>
	FLAGS[level].length === 0 ? "no sleep prevention" : `caffeinate ${FLAGS[level].join(" ")}`

export const Level = {
	type: "string",
	enum: LEVELS,
}

const Snapshot = {
	type: "object",
	properties: {
		level: Level,
		/** Sessions executing right now, across the whole server: the assertion is machine-wide. */
		running: { type: "number" },
		/** Whether our own `caffeinate` is up. */
		held: { type: "boolean" },
	},
	required: ["level", "running", "held"],
	additionalProperties: false,
} as const

/** A stalled call must not freeze a widget: the rejection is the point, the timer is cleared with it. */
export const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`rpc timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})

export interface CoffeeSnapshot {
	level: Level
	running: number
	held: boolean
}

export const Coffee = Rpc.define({
	id: "coffee",
	methods: {
		snapshot: {
			input: { type: "object", properties: {}, additionalProperties: false },
			output: Snapshot,
		},
		// The answer is the state after the write, so a click repaints without waiting for the poll.
		set: {
			input: {
				type: "object",
				properties: { level: Level },
				required: ["level"],
				additionalProperties: false,
			},
			output: Snapshot,
		},
	},
	// Present (empty) on purpose: a missing events map fails the whole plugin.
	events: {},
})

export default Coffee
