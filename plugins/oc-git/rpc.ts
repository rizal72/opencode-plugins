// The contract the desktop half reads: the git call stays on the server.
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
