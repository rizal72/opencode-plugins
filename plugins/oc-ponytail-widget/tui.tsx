// oc-ponytail-widget — TUI half: the level in the prompt footer, right of the cup, the glyph carrying
// the level's colour and the word the setting. Reading, glyph and colours: `docs/oc-ponytail-widget.md`.
import { Plugin } from "@opencode/plugin/tui"
import { createRoot, createSignal } from "solid-js"

import { Ponytail, withTimeout, type State } from "./rpc.ts"

/** md-horse_variant (U+F15C1). */
const GLYPH = "\u{f15c1}"

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_RED = "#f85149"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_DIM = "#8b949e"

const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

export default Plugin.define({
	id: "oc-ponytail-widget.tui",
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
		const RED = themeColour(["diff", "text", "removed"], ["syntax", "keyword"], ["text", "feedback", "error", "base"]) ?? FALLBACK_RED
		const YELLOW =
			themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ?? FALLBACK_YELLOW
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM

		const colour = (level: string): any =>
			level === "off" ? DIM : level === "lite" ? YELLOW : level === "ultra" ? RED : GREEN

		const rpc = context.client.rpc(Ponytail)
		// Reactive: the badge repaints when the level or the installation changes, and both come from the
		// server, so they arrive through a read rather than through a local variable.
		const [snapshot, setSnapshot] = createRoot(() => createSignal<State | undefined>(undefined))

		const shown = (): boolean => snapshot()?.installed === true
		const level = (): string => snapshot()?.level ?? "full"

		async function read(): Promise<void> {
			try {
				const next = await withTimeout(rpc.state({}), RPC_TIMEOUT_MS)
				setSnapshot(next as State)
			} catch {
				// Keep the last good reading: a failed read says nothing about the level.
			}
		}
		void read()

		/** Read inside the JSX: the renderer tracks the markup, not a local. */
		const Badge = () => (
			<box flexDirection="row" flexShrink={0}>
				<text fg={colour(level())} wrapMode="none">{shown() ? GLYPH : ""}</text>
				<text fg={DIM} wrapMode="none">{shown() ? ` ${level()}` : ""}</text>
			</box>
		)

		context.ui.slot({ append: "prompt.footer.status", render: () => <Badge /> })

		const clock = setInterval(() => void read(), REFRESH_MS)

		return () => {
			clearInterval(clock)
		}
	},
})
