// The contract both surfaces read.
import { Rpc } from "@opencode/plugin/rpc"

export const LEVELS = ["off", "lite", "full", "ultra"] as const

export type Level = (typeof LEVELS)[number]

export const isLevel = (value: unknown): value is Level => LEVELS.includes(value as Level)

export const Level = {
	type: "string",
	enum: LEVELS,
}

/** A call that never answers must not freeze a badge. */
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
		/** The level the package would apply; with `installed` false nothing applies it. */
		level: Level,
		/** `none` means `level` is the package's own default, `full`. */
		source: { type: "string", enum: ["state", "config", "none"] },
		/** False means no package applies the level at all. */
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
	// A store change is the client's refresh.
	events: {},
})
