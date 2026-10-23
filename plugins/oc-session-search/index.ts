// oc-session-search — the `session_search` tool: keyword search over past OpenCode sessions.
//
// Why a tool and not a command: the point is that the agent reaches for it on its own when the owner
// says "we discussed this already", without being told which command to run. It is registered with
// `codemode: true`, so it costs no prompt bytes: it sits in the Code Mode catalog as one line.
//
// The transcripts are in SQLite, not in files — search.ts carries the query and the self-check.
import { Plugin } from "@opencode/plugin"
import { searchSessions } from "./search.ts"

const input = {
	type: "object",
	properties: {
		query: { type: "string", description: "Case-insensitive regular expression." },
		project: { type: "string", description: "Substring of the project directory, e.g. OpenCode." },
		since: { type: "string", description: "Earliest date, YYYY-MM-DD." },
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
