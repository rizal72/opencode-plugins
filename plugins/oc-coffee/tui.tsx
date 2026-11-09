// oc-coffee — TUI half.
//
// The footer badge and the `/coffee` command: both read and write the server's state over `rpc.ts`. The
// level table, the badge's colours and why it stays visible at `off` are in `docs/oc-coffee.md`.
import { Plugin } from "@opencode/plugin/tui"
import { createRoot, createSignal } from "solid-js"

import { Coffee, LEVELS, isLevel, withTimeout, type CoffeeSnapshot, type Level } from "./rpc.ts"

/** md-coffee_outline (U+F06CA), the glyph pi's own badge uses. */
const CUP_GLYPH = "\u{f06ca}"

/** The poll: short, so the cup lights while the agent is still working. */
const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

/** The four menu rows: a title short enough that truncation never eats it, and the effect in words. */
const LEVEL_ROW: Record<Level, { title: string; detail: string }> = {
	off: { title: "Off", detail: "no prevention" },
	idle: { title: "Idle", detail: "Mac stays awake, screen may sleep" },
	display: { title: "Display", detail: "Mac and screen stay awake" },
	system: { title: "System", detail: "nothing sleeps, you count as active" },
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

		/** What the level is doing to the Mac at this moment, without the level's name: the menu already marks
		 *  that with the current row. */
		const stateText = (): string =>
			level() === "off"
				? "the Mac sleeps as usual"
				: held()
					? "the Mac is being kept awake now"
					: "nothing to keep awake right now"

		/** The same for a toast, where the level has to be said: nothing else on screen names it. */
		const describe = (): string => `Coffee: ${level()} — ${stateText()}`

		void read()
		const timer = setInterval(() => void read(), REFRESH_MS)

		/** The badge: the level as the setting, the cup lit while the assertion is up. */
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

						// `/coffee <level>` sets a level without the menu.
						if (isLevel(argument)) {
							await setLevel(argument)
							context.ui.toast.show({ message: describe() })
							return
						}
						if (argument !== undefined) {
							context.ui.toast.show({
								message: `usage: /coffee [${LEVELS.join(" | ")}]`,
								variant: "warning",
							})
							return
						}

						const picked = await context.ui.dialog.select({
							title: `${CUP_GLYPH} Sleep prevention`,
							current: level(),
							options: [
								...LEVELS.map((candidate) => ({
									title: LEVEL_ROW[candidate].title,
									description: LEVEL_ROW[candidate].detail,
									value: candidate as string,
								})),
								// A reading, not a setting: picking it only closes the menu. Not a disabled
								// option either — this app drops those from the list (docs/oc-coffee.md).
								{
									title: "Status",
									description: stateText(),
									value: "status",
									category: "Status",
								},
							],
						})
						if (isLevel(picked)) {
							await setLevel(picked)
							context.ui.toast.show({ message: describe() })
						}
					},
				},
			],
		}))

		return () => clearInterval(timer)
	},
})
