// The contract both surfaces read: the level pi and OpenCode share lives in one file, so neither client
// keeps a copy of its own — and the pill can move it without the terminal disagreeing.
import { Rpc } from "@opencode/plugin/rpc"

/** The package's runtime levels. `review` is session-only and can never be persisted. */
export const LEVELS = ["off", "lite", "full", "ultra"] as const

export type Level = (typeof LEVELS)[number]

export const isLevel = (value: unknown): value is Level => LEVELS.includes(value as Level)

export const Level = {
	type: "string",
	enum: LEVELS,
}

/** A call that never answers must not freeze a badge: both surfaces guard theirs with this. The timer is
 *  cleared with the answer, so a poll every two seconds does not leave a timer behind for fifteen. */
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

const State = {
	type: "object",
	properties: {
		/** The level the package would apply. With `installed` false nothing applies it, and the surfaces
		 *  draw nothing rather than name a level nobody runs. */
		level: Level,
		/** Where the level came from: the state file, the shared config, or nothing — in which case `level`
		 *  is the package's own default, `full`. */
		source: { type: "string", enum: ["state", "config", "none"] },
		/** Whether the ponytail package is loaded and `active` in this server. Read from the host's plugin
		 *  registry, not guessed from a file: false means nothing applies the level at all. */
		installed: { type: "boolean" },
	},
	required: ["level", "source", "installed"],
} as const

export type State = { level: Level; source: "state" | "config" | "none"; installed: boolean }

export const Ponytail = Rpc.define({
	id: "ponytail",
	methods: {
		state: {
			input: { type: "object", properties: {}, additionalProperties: false },
			output: State,
		},
		set: {
			input: { type: "object", properties: { level: Level }, required: ["level"], additionalProperties: false },
			output: State,
		},
	},
	// A store change is the client's refresh: nothing here is a stream.
	events: {},
})
