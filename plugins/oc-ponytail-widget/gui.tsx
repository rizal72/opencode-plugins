// oc-ponytail-widget — GUI half: the level as a composer capsule, the four levels as its rows — the
// selector the terminal never had. Icon, tones and the read/write split: `docs/oc-ponytail-widget.md`.
import { ComposerPill, Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup } from "solid-js"

import { LEVELS, Ponytail, withTimeout, type Level, type State } from "./rpc.ts"

const ICON = "glasses" as const
const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

const tone = (level: Level): "warning" | "success" | "danger" | undefined =>
	level === "off" ? undefined : level === "lite" ? "warning" : level === "ultra" ? "danger" : "success"

export default Plugin.define({
	setup(ctx) {
		const [state, setState] = createSignal<State | undefined>(undefined)
		/** One read at a time; `writes` tells a stale answer from a newer click. */
		let reading = false
		let writes = 0

		const rpc = () => ctx.sessions.current()?.server.client.rpc(Ponytail)

		const refresh = async () => {
			const call = rpc()
			if (!call || reading) return
			const before = writes
			reading = true
			try {
				const next = (await withTimeout(call.state({}), RPC_TIMEOUT_MS)) as State
				// A click may have landed while this was in flight: its answer is the newer one.
				if (writes === before) setState(next)
			} catch {
				// A failed read leaves the pill as it was; the next tick reads again.
			} finally {
				reading = false
			}
		}
		// `show` is only called while a session is routed, and the first read can happen before one is:
		// without this effect the pill stays hidden for the whole life of the window. The poll is what
		// catches a level set by `/ponytail` — that command writes a file and nothing tells the window.
		createEffect(() => {
			ctx.sessions.current()
			void refresh()
			const id = setInterval(() => void refresh(), REFRESH_MS)
			onCleanup(() => clearInterval(id))
		})

		ctx.add(ComposerPill, {
			id: "ponytail",
			order: 6,
			show: () => {
				const value = state()
				if (!value?.installed) return undefined
				const current = value.level
				return {
					label: current,
					icon: ICON,
					tone: tone(current),
					title: "Ponytail",
					rows: LEVELS.map((entry) => ({
						id: entry,
						label: entry,
						...(entry === current ? { icon: "check" as const, tone: "success" as const } : {}),
						run: () => {
							const call = rpc()
							if (!call) return
							void withTimeout(call.set({ level: entry }), RPC_TIMEOUT_MS)
								.then((next) => {
									writes += 1
									setState(next as State)
								})
								.catch((error: unknown) => {
									ctx.toast.show({
										title: "Ponytail",
										description: error instanceof Error ? error.message : String(error),
										variant: "error",
									})
								})
						},
					})),
				}
			},
		})
	},
})
