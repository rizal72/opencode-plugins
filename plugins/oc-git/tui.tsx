// oc-git — TUI half.
//
// The block is hidden, not drawn empty, when git cannot answer: an empty block is worse than no block.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

import { read, type Status } from "./git.ts"

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
		// identity colour in most themes.
		const ACCENT =
			themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT
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
					<text>
						<span style={{ fg: (state()!.ahead ?? 0) > 0 ? BASE : DIM }}>↑{state()!.ahead} </span>
						<span style={{ fg: (state()!.behind ?? 0) > 0 ? YELLOW : DIM }}>↓{state()!.behind}</span>
					</text>
				) : null}
			</box>
		)

		// Footer: the three figures, shown only when there is something to commit.
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
