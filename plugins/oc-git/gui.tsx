// oc-git — GUI half: the repository's state as a composer pill, which is the desktop's version of the
// footer's three counts. The branch and the three figures are the label — visible without a click — and
// the rows carry what the sidebar used to spell out: ahead, behind, and the three groups by name.
import { ComposerPill, Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup } from "solid-js"

import { Git, type GitStatus } from "./rpc.ts"

const REFRESH_MS = 3000

export default Plugin.define({
	setup(ctx) {
		const [state, setState] = createSignal<
			{ server: string; directory: string; status: GitStatus } | undefined
		>(undefined)
		let timer: ReturnType<typeof setInterval> | undefined
		// The directory whose read is in flight: one guard per directory, so a stale completion cannot clear
		// the flag of the read that is actually current.
		let reading: string | undefined

		// One poller for the session on screen: the pill asks per session, but only one session is shown.
		createEffect(() => {
			const session = ctx.sessions.current()
			const directory = session?.directory
			// The session's own server, not the app's: the read must happen where the files are, and a server
			// that does not run this plugin simply has no answer to give.
			const server = session?.server.id

			if (timer) clearInterval(timer)
			timer = undefined
			if (!directory || !server) {
				setState(undefined)
				return
			}

			const refresh = () => {
				if (reading === directory) return
				reading = directory
				// Read the client at every call: a restarted or re-authenticated server gets a new one under the
				// same id, and the old controller would answer nothing.
				void session?.server.client
					.rpc(Git)
					.status({ directory })
					.then((value) => {
						const status = value as GitStatus
						setState(status.ok ? { server, directory, status } : undefined)
					})
					// A failed read hides the pill instead of painting an error: outside a repository that is
					// the normal answer, and a broken call has no room to say so in a capsule.
					.catch(() => {
						// A late failure from the previous session must not wipe the fresh state of this one.
						if (ctx.sessions.current()?.directory !== directory) return
						setState(undefined)
					})
					.finally(() => {
						if (reading === directory) reading = undefined
					})
			}

			refresh()
			timer = setInterval(refresh, REFRESH_MS)
		})

		onCleanup(() => {
			if (timer) clearInterval(timer)
		})

		ctx.add(ComposerPill, {
			id: "git",
			order: 10,
			show: (input) => {
				const current = state()

				if (!current || current.directory !== input.session.directory) return undefined
				if (current.server !== input.session.server.id) return undefined
				const status = current.status
				const added = status.added ?? 0
				const modified = status.modified ?? 0
				const untracked = status.untracked ?? 0
				// As in the TUI block: `↑0 ↓0` is printed when an upstream exists, and nothing at all when it
				// does not — `ahead` is absent then, which is a different fact from being zero.
				const upstream = [
					status.ahead === undefined ? "" : `↑${status.ahead}`,
					status.behind === undefined ? "" : `↓${status.behind}`,
				]
					.filter(Boolean)
					.join(" ")
				// Capped here, not left to the pill: the host truncates the end of the label, and the end is
				// where the three counts are — a long branch name would take them with it.
				const branch = status.branch ?? ""
				const shown = branch.length > 20 ? branch.slice(0, 19) + "…" : branch

				// One rule for the capsule and for each row: yellow while there is something to do, green
				// when the answer is zero. `open-file` because `file-document` is a name the app's drawing
				// set does not carry — it draws a `plus`, which is already the added row's mark.
				const sum = added + modified + untracked
				const tone = (count: number) => (count > 0 ? "warning" : "success")

				return {
					icon: "branch",
					label: `${shown} +${added} ±${modified} ?${untracked}`,
					title: "Git status",
					tone: sum > 0 ? "warning" : "success",
					rows: [
						// The name is the news, so it is the row's own text: `detail` is muted, and a muted
						// value on the one line that matters reads as an aside.
						{ id: "branch", label: branch, icon: "branch", tone: tone(sum) },
						// Its own row, and only when there is an upstream: sharing the branch row's end lost it
						// to a long branch name, which is exactly where it is wanted.
						...(upstream ? [{ id: "upstream", label: upstream }] : []),
						{ id: "added", label: `+${added} added`, icon: "plus", tone: tone(added) },
						{ id: "modified", label: `±${modified} changed`, icon: "pencil-line", tone: tone(modified) },
						{ id: "untracked", label: `?${untracked} untracked`, icon: "open-file", tone: tone(untracked) },
					],
				}
			},
		})
	},
})
