// The contract the GUI half reads: a plugin window has no Node built-ins and no environment, so the two
// calls to the CLI stay on the server and the window asks for their result.
import { Rpc } from "@opencode/plugin/rpc"

/** One installed plugin that has a newer version published. */
export interface UpdateRow {
	/** The plugin's id, as `plugin list` names it: `oc-git`, `github-panel`. */
	id?: string
	/** What `plugin update` takes: the npm name, or the Git source. */
	target: string
	/** The installed version. The newer one is not in `Plugin.Info`: even `plugin check` does not know it. */
	version?: string
}

export interface CheckResult {
	ok: boolean
	error?: string
	/** When the list was read, so a held reading can say it is held. */
	at?: number
	rows?: UpdateRow[]
}

export interface UpdateResult {
	ok: boolean
	error?: string
}

export const Updates = Rpc.define({
	id: "updates",
	methods: {
		check: {
			input: {
				type: "object",
				properties: { force: { type: "boolean" } },
				additionalProperties: false,
			},
			output: {
				type: "object",
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" },
					at: { type: "number" },
					rows: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								target: { type: "string" },
								version: { type: "string" },
							},
							required: ["target"],
							additionalProperties: false,
						},
					},
				},
				required: ["ok"],
				additionalProperties: false,
			},
		},
		update: {
			input: {
				type: "object",
				properties: { targets: { type: "array", items: { type: "string" } } },
				required: ["targets"],
				additionalProperties: false,
			},
			output: {
				type: "object",
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" },
				},
				required: ["ok"],
				additionalProperties: false,
			},
		},
	},
	// Present (empty) on purpose: a missing events map fails the whole plugin.
	events: {},
})

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

export default Updates
