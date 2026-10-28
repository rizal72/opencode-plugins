// oc-git — server half.
//
// Empty to the terminal, which reads git itself, but not to the desktop: a GUI plugin window has no
// Node built-ins, so the read happens here and the window asks for it through `rpc.ts`.
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
				// `undefined` is not a number for the output validator, and the key being present is what
				// it checks: a repository without an upstream fails `ahead` unless the key is absent.
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

