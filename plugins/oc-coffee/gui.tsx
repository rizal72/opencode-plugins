// oc-coffee — GUI half.
//
// The desktop has no footer, so the cup becomes a pill above the composer: the level as the capsule,
// lit while the machine is actually kept awake, and the four levels as the rows behind it.
//
// The state is not read from the system: the server holds it, having spawned the child itself, and
// this window asks over `rpc.ts`. That is what makes the pill and the terminal's badge agree — they
// are two views of one answer, not two answers.
//
// `monitor` stands in for the cup: the app's icon set has no cup, and `tone` colours the icon only.
// The name is written once, so the day the set grows it is one line.
import { ComposerPill, Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup } from "solid-js"

import { Coffee, LEVELS, flagsText, withTimeout, type CoffeeSnapshot, type Level } from "./rpc.ts"

/** Short: the cup has to light while the agent is still working. */
const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

const ICON = "monitor" as const

export default Plugin.define({
	setup(ctx) {
		const [snapshot, setSnapshot] = createSignal<{ server: string; value: CoffeeSnapshot } | undefined>(undefined)
		let timer: ReturnType<typeof setInterval> | undefined
		let reading: string | undefined

		createEffect(() => {
			const session = ctx.sessions.current()
			const server = session?.server.id

			if (timer) clearInterval(timer)
			timer = undefined
			if (!server) {
				setSnapshot(undefined)
				return
			}

			const refresh = () => {
				if (reading === server) return
				reading = server
				void withTimeout(session!.server.client.rpc(Coffee).snapshot({}), RPC_TIMEOUT_MS)
					.then((value) => {
						if (ctx.sessions.current()?.server.id === server) setSnapshot({ server, value: value as CoffeeSnapshot })
					})
					.catch(() => {
						// Keep the last good reading: a failed read says nothing about the level.
					})
					.finally(() => {
						if (reading === server) reading = undefined
					})
			}

			refresh()
			timer = setInterval(refresh, REFRESH_MS)
		})

		onCleanup(() => {
			if (timer) clearInterval(timer)
		})

		const pick = (level: Level) => {
			const session = ctx.sessions.current()
			if (!session) return
			void withTimeout(session.server.client.rpc(Coffee).set({ level }), RPC_TIMEOUT_MS)
				.then((value) => setSnapshot({ server: session.server.id, value: value as CoffeeSnapshot }))
				.catch((error) =>
					ctx.toast.show({
						title: "Coffee",
						description: error instanceof Error ? error.message : String(error),
						variant: "error",
					}),
				)
		}

		ctx.add(ComposerPill, {
			id: "coffee",
			order: 5,
			show: (input) => {
				const current = snapshot()
				if (!current || current.server !== input.session.server.id) return undefined
				const value = current.value

				return {
					label: value.level,
					icon: ICON,
					tone: value.held ? "success" : undefined,
					title: "Coffee: sleep prevention",
					rows: LEVELS.map((level) => ({
						id: level,
						label: level,
						// The check marks the level in force, and it is green because it is a state, not a
						// label: the row that is doing something says so in colour, like the capsule does.
						...(level === value.level ? { icon: "check" as const, tone: "success" as const } : {}),
						detail: flagsText(level),
						run: () => pick(level),
					})),
				}
			},
		})
	},
})
