// oc-git — TUI half.
//
// The repository's state in the sidebar, vertical because the sidebar has room:
//
//   <git glyph> Git status
//   <branch glyph> main
//   +2  ±1  ?0
//   ↑1 ↓3
//
// Branch, then the files that have something to commit — added (index `A`), everything else that
// changed (`M`, `T`, `D`, `R`, `U`), and untracked — then ahead/behind, which appears only when an
// upstream exists. Zeros are the point: a clean repository reads `+0 ±0 ?0` and no extra word is
// needed to say so.
//
// Colour: the title in bold white, the branch in the theme's accent, and each count on its own — the
// warning yellow when that figure is not zero, grey when it is. A clean repository is therefore three
// grey zeros, which is the point: it should not catch the eye.
//
// Data: `git status --porcelain=v2 --branch`, one read-only call, chosen over the plugin API's
// `ctx.vcs` because that one exposes the branch and the file list but not the counts this block is
// built on, nor ahead/behind. The call runs on a timer, skipped while the previous one is still
// running, so a very large repository cannot stack reads.
//
// The block is hidden whenever git cannot answer — outside a repository, or on a machine without
// git — because an empty block is worse than no block.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

import { read, type Status } from "./git.ts"

/** The two glyphs pi's own widget uses, copied from there — verified by reading the codepoints
 *  back out of this file, never from memory. */
const BRANCH_GLYPH = ""
const GIT_GLYPH = ""

const REFRESH_MS = 3000

const FALLBACK_ACCENT = "#79c0ff"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_DIM = "#8b949e"

export default Plugin.define({
	id: "oc-git.tui",
	setup(context: any) {
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}
		const BASE = themeColour(["text", "base"])
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
		// One accent for everything that is a *value*, never a state: `syntax.function` is the blue-ish
		// identity colour in most themes. Green and yellow are deliberately not used — in this UI they
		// mean ok and warning, and a count is neither.
		const ACCENT =
			themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT
		/** The warning yellow the other sidebar blocks use — here it means "there is something to
		 *  commit", the one state this block exists to announce. */
		const YELLOW =
			themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ??
			FALLBACK_YELLOW

		const [state, setState] = createSignal<Status | undefined>(undefined)
		const location = context.location ?? context.data.location.default()

		let reading = false
		function refresh(): void {
			if (reading) return
			const directory = location?.directory
			if (!directory) return
			reading = true
			void read(directory).then((status) => {
				reading = false
				setState(status)
			})
		}

		refresh()
		const timer = setInterval(refresh, REFRESH_MS)

		const Block = () => (
			<box>
				<text fg={BASE}>
					<span style={{ fg: DIM }}>{GIT_GLYPH} </span>
					<b>Git status</b>
				</text>
				<text>
					<span style={{ fg: DIM }}>{BRANCH_GLYPH} </span>
					<span style={{ fg: ACCENT }}>{state()!.branch}</span>
				</text>
				<text>
					<span style={{ fg: state()!.added > 0 ? YELLOW : DIM }}>+{state()!.added}</span>
					<span style={{ fg: DIM }}> </span>
					<span style={{ fg: state()!.modified > 0 ? YELLOW : DIM }}>±{state()!.modified}</span>
					<span style={{ fg: DIM }}> </span>
					<span style={{ fg: state()!.untracked > 0 ? YELLOW : DIM }}>?{state()!.untracked}</span>
				</text>
				{state()!.ahead !== undefined ? (
					<text fg={DIM}>
						↑{state()!.ahead} ↓{state()!.behind}
					</text>
				) : null}
			</box>
		)

		// Footer: the branch is already printed there by the TUI, and the whole block lives in the
		// sidebar, so the glyph and the three figures are the entire message. Shown only when there is
		// something to commit: on a narrow screen that is the point — the sidebar is gone, and this is
		// the one line that still has to reach the eye.
		const dirty = () => {
			const current = state()
			return !!current && (current.added > 0 || current.modified > 0 || current.untracked > 0)
		}

		const Numbers = () => (
			<box flexDirection="row" flexShrink={0}>
				<text fg={DIM} wrapMode="none">
					{GIT_GLYPH}{" "}
				</text>
				<text fg={state()!.added > 0 ? YELLOW : DIM} wrapMode="none">
					+{state()!.added}
				</text>
				<text fg={DIM} wrapMode="none">
					{" "}
				</text>
				<text fg={state()!.modified > 0 ? YELLOW : DIM} wrapMode="none">
					±{state()!.modified}
				</text>
				<text fg={DIM} wrapMode="none">
					{" "}
				</text>
				<text fg={state()!.untracked > 0 ? YELLOW : DIM} wrapMode="none">
					?{state()!.untracked}
				</text>
			</box>
		)

		context.ui.slot({
			prepend: "sidebar.content",
			render: () => (state() ? <Block /> : null),
		})

		context.ui.slot({
			append: "prompt.footer.status",
			render: () => (dirty() ? <Numbers /> : null),
		})

		return () => clearInterval(timer)
	},
})
