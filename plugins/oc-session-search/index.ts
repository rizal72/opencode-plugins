// oc-session-search — the `session_search` tool: keyword search over past OpenCode sessions.
//
// Registered with `codemode: true`, so it costs no prompt bytes. search.ts carries the query and the
// self-check; the why of it all is in docs/oc-session-search.md.
import { Plugin } from "@opencode/plugin"
import { searchSessions } from "./search.ts"

const input = {
	type: "object",
	properties: {
		query: {
			type: "string",
			description:
				"Words to look for, all of them scored: a message holding more of them ranks first. Written as a regular expression when it contains regex syntax.",
		},
		project: { type: "string", description: "Substring of the project directory, e.g. OpenCode." },
		since: { type: "string", description: "Earliest date, YYYY-MM-DD, inclusive." },
		until: { type: "string", description: "Latest date, YYYY-MM-DD, inclusive." },
		limit: { type: "number", description: "Max hits, default 10, max 40." },
	},
	required: ["query"],
} as const

export default Plugin.define({
	id: "oc-session-search",
	async setup(context: any) {
		await context.tool.transform((editor: any) => {
			editor.add({
				name: "session_search",
				description:
					"Search past OpenCode session transcripts by keyword: measurements, failed attempts, decisions and their reasons, tool quirks. Returns date, project, session id, title, role and a raw snippet. To read a whole session: `opencode api get /api/session/<id>/message`.",
				input,
				options: { codemode: true },
				async execute(params: any) {
					const { text } = await searchSessions(params)
					return { content: [{ type: "text", text }] }
				},
			})
		})
	},
})
