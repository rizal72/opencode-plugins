// The one contract shared by the server half and the TUI half of the plugin.
// The server registers it and implements `snapshot`; the TUI imports the same
// definition to build an RPC client, so the two can never drift.
import { Rpc } from "@opencode/plugin/rpc"

/** One budget window: how much of it is spent, its status, and when it resets. */
const Window = {
	type: "object",
	properties: {
		status: { type: "string" },
		percent: { type: "number" },
		resetsAt: { type: "string" },
	},
	additionalProperties: false,
}

export const Budget = Rpc.define({
	id: "budget",
	methods: {
		snapshot: {
			input: {
				type: "object",
				properties: { force: { type: "boolean" } },
				additionalProperties: false,
			},
			output: {
				type: "object",
				properties: {
					at: { type: "number" },
					go: {
						type: "object",
						properties: {
							rolling: Window,
							weekly: Window,
							monthly: Window,
							error: { type: "string" },
						},
						additionalProperties: false,
					},
					ds: {
						type: "object",
						properties: {
							balance: { type: "number" },
							currency: { type: "string" },
							error: { type: "string" },
						},
						additionalProperties: false,
					},
					or: {
						type: "object",
						properties: {
							balance: { type: "number" },
							totalCredits: { type: "number" },
							totalUsage: { type: "number" },
							usageMonthly: { type: "number" },
							error: { type: "string" },
						},
						additionalProperties: false,
					},
					zen: {
						type: "object",
						properties: {
							/** The ledger: signed, and negative when a request cost more than was left. */
							balance: { type: "number" },
							/** The spendable credit, the figure the console prints; the balance clamped at 0. */
							available: { type: "number" },
							/** The console workspace: it pays, and it owns this balance. */
							org: { type: "string" },
							/** How many console connections exist: with one, the name is noise. */
							peers: { type: "number" },
							error: { type: "string" },
						},
						additionalProperties: false,
					},
				},
				required: ["at"],
				additionalProperties: false,
			},
		},
	},
	// Present (empty) on purpose: the loader walks `events` and a missing map is a
	// hard failure rather than an empty one.
	events: {},
})

export interface UsageWindow {
	status?: string
	percent?: number
	resetsAt?: string
}

export interface BudgetSnapshot {
	at: number
	go?: {
		rolling?: UsageWindow
		weekly?: UsageWindow
		monthly?: UsageWindow
		error?: string
	}
	ds?: { balance?: number; currency?: string; error?: string }
	or?: {
		balance?: number
		totalCredits?: number
		totalUsage?: number
		usageMonthly?: number
		error?: string
	}
	zen?: { balance?: number; available?: number; org?: string; peers?: number; error?: string }
}

export default Budget
