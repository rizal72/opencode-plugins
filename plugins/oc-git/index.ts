// oc-git — server half: the read the desktop half asks for through `rpc.ts`. Empty to the terminal,
// which reads git itself.
import { Plugin } from "@opencode/plugin"

import { read } from "./git.ts"
import { Git } from "./rpc.ts"

export default Plugin.define({
	id: "oc-git",
	async setup(ctx) {
		await ctx.rpc.register(Git, {
			status: async (input: any) => {
				const directory = String(input?.directory ?? "")
				const status = directory ? await read(directory) : undefined

				if (!status) return { ok: false }
				// An absent key, not `undefined`: that is the shape the output validator accepts.
				const { branch, added, modified, untracked } = status
				return {
					ok: true,
					branch,
					added,
					modified,
					untracked,
					...(status.ahead === undefined ? {} : { ahead: status.ahead }),
					...(status.behind === undefined ? {} : { behind: status.behind }),
				}
			},
		})
	},
})

