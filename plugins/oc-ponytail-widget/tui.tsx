// oc-ponytail-widget — TUI half.
//
// The badge pi has and OpenCode was missing: the ponytail level in the prompt footer, to the right of
// the coffee cup — 󱗁 full. The **glyph carries the level's colour**, the same table the desktop pill
// uses (off dim, lite yellow, full green, ultra red); the **level word** stays dim and carries the
// setting. pi hides it; that is a deliberate deviation.
// (pi's own extension publishes this as a status key, drawn by pi's footer; the OpenCode half of the
// package is **server-only** — no TUI part at all, verified 2026-10-17 — so this is ours.)
//
// md-horse_variant (U+F15C1). Nerd Fonts has **no** ponytail glyph (checked against its own
// `glyphnames.json`: nothing for pony/tail/hair/mane/braid), and the `fa-*` horses live at
// U+E000–U+F8FF, a range the owner's font does not cover in every rendering path — the `md-*` range
// (plane 15) it does.
//
// The level comes from the server half, over `rpc.ts`, and not from the files: the one thing the badge
// needs that no file can answer is whether ponytail is installed at all, and only the host's plugin
// registry knows (`index.ts`). One reader, two renderers — the badge and the pill cannot disagree.
//
// **Nothing is drawn while ponytail is not active.** `off` is a level the package can apply; "not
// installed" is not `off`, and a badge that showed the same word for both would say nothing true. The
// level is polled every two seconds: the pill and `/ponytail` can write it at any moment.
import { Plugin } from "@opencode/plugin/tui"
import { createRoot, createSignal } from "solid-js"

import { Ponytail, withTimeout, type State } from "./rpc.ts"

/** md-horse_variant (U+F15C1) — a horse, because the ponytail glyph does not exist. */
const GLYPH = "\u{f15c1}"

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_RED = "#f85149"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_DIM = "#8b949e"

/** The cup's cadence: the same kind of fact, so the same clock. */
const REFRESH_MS = 2_000
/** A call that never answers must not freeze the badge: the cup's guard, and the same 15 s. */
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

		/** The level's colour, the same table the pill uses: one fact, two renderers. `off` is not a
		 *  warning, it is nothing — so it takes no colour and stays legible as a word. */
		const colour = (level: string): any =>
			level === "off" ? DIM : level === "lite" ? YELLOW : level === "ultra" ? RED : GREEN

		const rpc = context.client.rpc(Ponytail)
		// Reactive: the badge repaints when the level or the installation changes, and both come from the
		// server, so they arrive through a read rather than through a local variable.
		const [snapshot, setSnapshot] = createRoot(() => createSignal<State | undefined>(undefined))

		/** Nothing until the first answer: an empty badge for a moment beats a level nobody has confirmed. */
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

		/** The signal is read inside the JSX, exactly as the cup does: the TUI's renderer tracks the
		 *  expressions in the markup, and a value pulled into a local before the return is read once
		 *  (measured 2026-10-28, the badge never moved again). */
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
