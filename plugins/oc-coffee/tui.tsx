// oc-coffee — TUI half.
//
// Keeps the Mac awake while the agent works: the port of pi's `pi-coffee`.
//
//   off | idle | display | system      ->  caffeinate (), (-i), (-i -d), (-i -d -s -u)
//
// The level and the assertion are not held here any more. They are one fact for the whole machine —
// the desktop app is a second client, and two clients with a copy each are two answers to one
// question — so the server owns them (`index.ts`) and this half only reads and writes them over
// `rpc.ts`. Measured 2026-10-27: the server does receive `session.execution.started` and
// `.succeeded`, which the 2026-10-16 note said it did not.
//
// The badge shows the level whenever it is not `off` — the setting, not the moment — and only the
// cup lights up (green) while the assertion is up, so the state is one mark and the level stays
// legible. `/coffee` opens the menu, `/coffee <level>` sets one, `/coffee status` reports.
//
// macOS only: elsewhere the server never spawns the child, and the badge simply never lights.
import { Plugin } from "@opencode/plugin/tui"
import { createRoot, createSignal } from "solid-js"

import { Coffee, LEVELS, flagsText, isLevel, withTimeout, type CoffeeSnapshot, type Level } from "./rpc.ts"

/** md-coffee_outline (U+F06CA), the glyph pi's own badge uses. */
const CUP_GLYPH = "\u{f06ca}"

/** Short: the read is a local call, and the cup must light while the agent is still working. */
const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

/** The four menu rows, the wording pi uses. */
const LEVEL_MENU: Record<Level, string> = {
	off: "Off — Do not prevent any sleep",
	idle: "Prevent Idle Sleep — Keep the system awake while the agent works (caffeinate -i)",
	display: "Prevent Display Sleep — Also keep the display from idle-sleeping (caffeinate -i -d)",
	system: "Prevent System Sleep — Also block all system sleep on AC and declare the user active (caffeinate -i -d -s -u)",
}

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_DIM = "#8b949e"

/** The server's own default, so the first paint is not an empty badge; the first read replaces it. */
const DEFAULT: CoffeeSnapshot = { level: "display", running: 0, held: false }

export default Plugin.define({
	id: "oc-coffee.tui",
	setup(context: any) {
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}
		const GREEN =
			themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ??
			FALLBACK_GREEN
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM

		const rpc = context.client.rpc(Coffee)
		// Reactive: the badge must repaint when the assertion goes up or down, and that now happens in
		// the server, so it arrives through a read rather than through a local variable.
		const [snapshot, setSnapshot] = createRoot(() => createSignal<CoffeeSnapshot>(DEFAULT))

		const level = (): Level => snapshot().level
		const held = (): boolean => snapshot().held

		async function read(): Promise<void> {
			try {
				const next = await withTimeout(rpc.snapshot({}), RPC_TIMEOUT_MS)
				setSnapshot(next as CoffeeSnapshot)
			} catch {
				// Keep the last good reading: a failed read says nothing about the level.
			}
		}

		/** The level can only change from the command, where a failure is worth a word. */
		async function setLevel(next: Level): Promise<void> {
			try {
				// The RPC answers the state after the write, so the badge repaints without a second read.
				setSnapshot((await rpc.set({ level: next })) as CoffeeSnapshot)
			} catch (error) {
				context.ui.toast.show({
					message: `coffee: ${error instanceof Error ? error.message : String(error)}`,
					variant: "warning",
				})
			}
		}

		const describe = (): string =>
			`Sleep prevention: ${level() === "off" ? "off" : `${level()} (${flagsText(level())})`} — assertion ${held() ? "up" : "idle"}`

		void read()
		const timer = setInterval(() => void read(), REFRESH_MS)

		/** Always visible, `off` included: the badge is the setting, and seeing `off` is how you
		 *  know the plugin is loaded and deliberately doing nothing. (pi hides it when off; the
		 *  owner asked for the name instead.) */
		const Badge = () => (
			<box flexDirection="row" flexShrink={0}>
				<text fg={held() ? GREEN : DIM} wrapMode="none">{CUP_GLYPH}</text>
				<text fg={DIM} wrapMode="none"> {level()}</text>
			</box>
		)

		context.ui.slot({ append: "prompt.footer.status", render: () => <Badge /> })

		context.keymap.layer(() => ({
			mode: "global",
			commands: [
				{
					id: "oc-coffee.menu",
					title: "Coffee: sleep prevention",
					group: "Coffee",
					palette: true,
					slash: { name: "coffee", arguments: true },
					run: async (input?: string) => {
						await read()
						const argument = (input ?? "").trim().split(/\s+/).filter(Boolean)[0]

						if (argument === "status") {
							await context.ui.dialog.alert({ title: `${CUP_GLYPH} Coffee`, message: describe() })
							return
						}
						if (isLevel(argument)) {
							await setLevel(argument)
							context.ui.toast.show({ message: describe() })
							return
						}
						if (argument !== undefined) {
							context.ui.toast.show({
								message: `usage: /coffee [${LEVELS.join(" | ")} | status]`,
								variant: "warning",
							})
							return
						}

						const picked = await context.ui.dialog.select({
							title: `${CUP_GLYPH} Sleep prevention`,
							current: level(),
							options: LEVELS.map((candidate) => ({
								title: LEVEL_MENU[candidate],
								value: candidate,
							})),
						})
						if (picked) {
							await setLevel(String(picked) as Level)
							context.ui.toast.show({ message: describe() })
						}
					},
				},
			],
		}))

		return () => clearInterval(timer)
	},
})
