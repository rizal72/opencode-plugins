// oc-git — GUI half: the repository's state as a composer pill, the desktop's version of the same
// figures.
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
			// The session's own server, not the app's: the read must happen where the files are.
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
				void session?.server.client
					.rpc(Git)
					.status({ directory })
					.then((value) => {
						const status = value as GitStatus
						setState(status.ok ? { server, directory, status } : undefined)
					})
					// A failed read hides the pill: a capsule has no room to say an error.
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
				// Nothing at all without an upstream: `ahead` is absent then, a different fact from zero.
				const upstream =
					status.ahead === undefined ? undefined : `↑${status.ahead} ↓${status.behind ?? 0}`
				const arrows = [
					(status.ahead ?? 0) > 0 ? `↑${status.ahead}` : "",
					(status.behind ?? 0) > 0 ? `↓${status.behind}` : "",
				]
					.filter(Boolean)
					.join(" ")
				const branch = status.branch ?? ""
				// Never below one: those counts are absurd, but a negative slice would mangle the name instead.
				const room = Math.max(1, 20 - (arrows ? arrows.length + 1 : 0))
				const shown = branch.length > room ? branch.slice(0, room - 1) + "…" : branch

				const sum = added + modified + untracked
				const tone = (count: number) => (count > 0 ? "warning" : "success")
				const capsuleTone = sum > 0 || (status.behind ?? 0) > 0 ? "warning" : "success"

				return {
					icon: "branch",
					label: `${shown} +${added} ±${modified} ?${untracked}${arrows ? " " + arrows : ""}`,
					title: "Git status",
					tone: capsuleTone,
					rows: [
						{ id: "branch", label: branch, icon: "branch", tone: capsuleTone },
						...(upstream === undefined ? [] : [{ id: "upstream", label: upstream }]),
						{ id: "added", label: `+${added} added`, icon: "plus", tone: tone(added) },
						{ id: "modified", label: `±${modified} changed`, icon: "pencil-line", tone: tone(modified) },
						{ id: "untracked", label: `?${untracked} untracked`, icon: "open-file", tone: tone(untracked) },
					],
				}
			},
		})
	},
})
