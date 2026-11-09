// The contract both surfaces read: the server owns the configuration file, so no client keeps a copy.
import { Rpc } from "@opencode/plugin/rpc"

export const MODES = ["always", "away", "off"] as const

export type Mode = (typeof MODES)[number]

export const isMode = (value: unknown): value is Mode => MODES.includes(value as Mode)

/** The only characters ntfy accepts in a topic. */
export const TOPIC = /^[-_A-Za-z0-9]{1,64}$/

export interface Snapshot {
	mode: Mode
	awayAfter: number
	includeTitle: boolean
	topic: string
	/** The file did not parse: this is the last configuration that did. */
	broken: boolean
}

export const Mode = {
	type: "string",
	enum: MODES,
} as const

const Snapshot = {
	type: "object",
	properties: {
		mode: Mode,
		awayAfter: { type: "number" },
		includeTitle: { type: "boolean" },
		topic: { type: "string" },
		broken: { type: "boolean" },
	},
	required: ["mode", "awayAfter", "includeTitle", "topic", "broken"],
	additionalProperties: false,
} as const

export const Notify = Rpc.define({
	id: "notify",
	methods: {
		get: {
			input: { type: "object", properties: {}, additionalProperties: false },
			output: Snapshot,
		},
		// The answer is the state after the write, so the page repaints from one reply.
		set: {
			input: {
				type: "object",
				properties: {
					mode: Mode,
					awayAfter: { type: "number" },
					includeTitle: { type: "boolean" },
					topic: { type: "string" },
				},
				required: ["mode", "awayAfter", "includeTitle", "topic"],
				additionalProperties: false,
			},
			output: Snapshot,
		},
	},
	// Empty, never removed — the doc, Traps.
	events: {},
})

export default Notify
