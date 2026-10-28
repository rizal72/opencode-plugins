// The contract the GUI half reads: a plugin window has no Node built-ins, so the git call stays on the
// server and the window asks for its result.
import { Rpc } from "@opencode/plugin/rpc"

const Count = { type: "number" }

export const Git = Rpc.define({
	id: "git",
	methods: {
		status: {
			input: {
				type: "object",
				properties: { directory: { type: "string" } },
				required: ["directory"],
				additionalProperties: false,
			},
			output: {
				type: "object",
				properties: {
					/** False outside a repository: a valid answer, not a failed call. */
					ok: { type: "boolean" },
					branch: { type: "string" },
					ahead: Count,
					behind: Count,
					added: Count,
					modified: Count,
					untracked: Count,
				},
				required: ["ok"],
				additionalProperties: false,
			},
		},
	},
	// Present (empty) on purpose: a missing events map fails the whole plugin.
	events: {},
})

export interface GitStatus {
	ok: boolean
	branch?: string
	ahead?: number
	behind?: number
	added?: number
	modified?: number
	untracked?: number
}

export default Git
