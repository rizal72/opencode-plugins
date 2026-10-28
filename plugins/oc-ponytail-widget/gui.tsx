// oc-ponytail-widget — GUI half.
//
// The terminal puts the badge in the prompt footer; the desktop has the pills row instead, so the level
// becomes the capsule and the four levels the rows behind it — the selector the terminal never had.
//
// Read and write go through the server half (`rpc.ts`): the level is a file in the ponytail package's own
// config, and a window has no filesystem.
//
// `glasses` stands in for the horse: the icon set has neither a horse nor a ponytail, and the horse was a
// Nerd Font stand-in in the terminal. The label carries the level; the icon only says which pill this is.
import { ComposerPill, Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup } from "solid-js"

import { LEVELS, Ponytail, withTimeout, type Level, type State } from "./rpc.ts"

const ICON = "glasses" as const
/** The cup's cadence, on both surfaces: same kind of fact, so the same clock. */
const REFRESH_MS = 2_000
/** A call that never answers must not freeze the pill: the cup's guard, and the same 15 s. */
const RPC_TIMEOUT_MS = 15_000

/** The level's colour, the same table the terminal badge uses: one fact, two renderers. `off` takes no
 *  tone at all — it is not a warning, it is nothing — so the capsule keeps its normal colour. */
const tone = (level: Level): "warning" | "success" | "danger" | undefined =>
	level === "off" ? undefined : level === "lite" ? "warning" : level === "ultra" ? "danger" : "success"

export default Plugin.define({
	setup(ctx) {
		const [state, setState] = createSignal<State | undefined>(undefined)
		/** One read at a time, and a click outranks a poll that was already in flight. */
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
				// No ponytail, nothing to offer: the rows would write a file no package reads, and the
				// write would sit there to surprise whoever installs ponytail next. A control that cannot
				// act is not drawn — the same rule the terminal badge follows by drawing nothing.
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
						// The check marks the level in force, and it is green because that is a state, not a
						// label: the row doing something says so in colour, like coffee's does.
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
