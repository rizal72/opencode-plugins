// oc-context — TUI half.
//
// The **context block in the sidebar**: the lines OpenCode's own `opencode.sidebar.context` prints
// there —
//
//   Context
//   409,907 tokens
//   41% used
//   $2.18 spent
//
// — with the one thing that block leaves out: **the window the percent is a percent of**
// (`41% used of 1.0M`). Colour follows the rule the other widgets use: **green normally, yellow from
// 60% of the window, red from 80%** — only the numbers take it, the labels stay muted, and the window
// itself wears the theme's accent, the same blue as the branch name in `oc-git`.
//
// Why the built-in is taken over rather than complemented: the block is one render with no slot
// inside it, so a line cannot be inserted into it from outside — and its contribution to
// `sidebar.content` is that block and nothing else (`setup` registers exactly one slot), so switching
// it off costs nothing we do not redraw here.
//
// The **prompt footer is not ours**. `opencode.prompt.footer` stays enabled: it draws the context
// figure (`409.9K (41%)` — without the total, which is why the total lives in this block), the
// child-session chip (`^↓ 2 subagents · 1 shell`, clickable), the `agents` and `commands` hints and
// `esc exit shell mode`. Switching that one off to replace its figure once **cost us the chip with
// it**; the record keeps the lesson and the full composition of both footer rows
// (`docs/oc-context.md`).
//
// Config: `-opencode.sidebar.context` in `~/.config/opencode/cli.json`; the block reaches the top of
// the sidebar by **prepending** to `sidebar.content` (`docs/sidebar.md`).
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"

/** Where the figure starts warning, and where it says act now — in **percent of the model's window**,
 *  so every window warns on its own scale, the way the budget widget warns on the wallet's. */
const CONTEXT_YELLOW_PERCENT = 60
const CONTEXT_RED_PERCENT = 80

/** md-counter (U+F0199), the block's mark — every sidebar block carries one. */
const CONTEXT_GLYPH = "\u{f0199}"

const FALLBACK_GREEN = "#3fb950"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_RED = "#f85149"
const FALLBACK_ACCENT = "#79c0ff"
const FALLBACK_DIM = "#8b949e"

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

/** Compact token count, the shape the TUI itself prints ("1.0M"). */
function compactTokens(value: number): string {
	if (value < 1000) return String(value)
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`
	return `${(value / 1_000_000).toFixed(1)}M`
}

/** The context figure, a port of the TUI's own `xr` + `b$`: the last assistant message that
 *  carries tokens, skipping anything before the last completed compaction and anything after a
 *  revert point. Same rule as the built-in, so the two can never disagree. */
function contextUsage(
	messages: any[] | undefined,
	revertMessageID: string | undefined,
): { used: number; ref?: any } | undefined {
	if (!messages || messages.length === 0) return undefined
	const revert = revertMessageID ? messages.findIndex((message) => message?.id === revertMessageID) : -1
	if (revertMessageID && revert === -1) return undefined
	const stop = revert === -1 ? messages.length : revert
	let compaction = -1
	for (let i = stop - 1; i >= 0; i--) {
		if (messages[i]?.type === "compaction" && messages[i]?.status === "completed") {
			compaction = i
			break
		}
	}
	let picked: any
	for (let i = stop - 1; i > compaction; i--) {
		if (messages[i]?.type === "assistant" && messages[i]?.tokens !== undefined) {
			picked = messages[i]
			break
		}
	}
	if (!picked) return undefined
	const tokens = picked.tokens
	const used = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
	if (used <= 0) return undefined
	return { used, ref: picked.model }
}

export default Plugin.define({
	id: "oc-context.tui",
	setup(context: any) {
		/** First candidate path the theme defines; colours are the renderer's own type. */
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
		// Chosen by eye across several themes, hunting for tokens that keep the same *kind* of colour
		// everywhere: `text.feedback.warning` is the yellow, `diff.text.removed` the red, the rest are
		// fallbacks. (A first pass used `syntax.type` for yellow — too pale — and `text.feedback.error`
		// for red: each one theme away from reading wrong.)
		const YELLOW =
			themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ??
			FALLBACK_YELLOW
		const RED =
			themeColour(["diff", "text", "removed"], ["syntax", "keyword"], ["text", "feedback", "error", "base"]) ??
			FALLBACK_RED
		// Green is the normal state, the same green the budget widget uses for a healthy wallet.
		const GREEN =
			themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ??
			FALLBACK_GREEN
		// The window is a value, not a state: the theme's accent, the same blue as `oc-git`'s branch.
		const ACCENT =
			themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT

		const Block = (props: any) => {
			/** Everything the block needs, **pre-formatted in the memo** — a value read in the callback
			 *  body of a `Show` is read once and never again. */
			const figure = createMemo(() => {
				const sessionID = props.sessionID
				if (!sessionID) return undefined
				const session = context.data.session.get(sessionID)
				if (!session) return undefined
				const models = context.data.location.model.list(session.location)
				const usage = contextUsage(context.data.session.message.list(sessionID), session.revert?.messageID)
				const cost = context.data.session.cost(sessionID)
				const spent = typeof cost === "number" && cost > 0 ? USD.format(cost) : undefined
				// The built-in block appears only once there is something to report; so does this one.
				if (!usage && !spent) return undefined
				const ref = usage?.ref ?? session.model
				const model = models?.find(
					(candidate: any) => candidate.providerID === ref?.providerID && candidate.id === ref?.id,
				)
				const limit = model?.limit?.context
				const positive = typeof limit === "number" && limit > 0
				const used = usage?.used ?? 0
				// The level of the **window**, not of the count: a smaller window warns on its own scale.
				const percent = usage && positive ? (used / limit) * 100 : undefined
				return {
					tokens: used.toLocaleString(),
					percent: percent === undefined ? undefined : Math.round(percent),
					window: positive ? compactTokens(limit) : undefined,
					spent,
					colour:
						percent === undefined
							? GREEN
							: percent >= CONTEXT_RED_PERCENT
								? RED
								: percent >= CONTEXT_YELLOW_PERCENT
									? YELLOW
									: GREEN,
				}
			})

			return (
				<Show when={figure()}>
					{(value: any) => (
						<box>
							<text fg={BASE}>
								<span style={{ fg: DIM }}>{CONTEXT_GLYPH} </span>
								<b>Context</b>
							</text>
							<text>
								<span style={{ fg: value().colour }}>{value().tokens}</span>
								<span style={{ fg: DIM }}> tokens</span>
							</text>
							<Show when={value().percent !== undefined}>
								<text>
									<span style={{ fg: value().colour }}>{value().percent}</span>
									<span style={{ fg: DIM }}>% used</span>
									<Show when={value().window}>
										<span style={{ fg: DIM }}> of </span>
										<span style={{ fg: ACCENT }}>{value().window}</span>
									</Show>
								</text>
							</Show>
							<Show when={value().spent}>
								<text fg={DIM}>{value().spent} spent</text>
							</Show>
						</box>
					)}
				</Show>
			)
		}

		context.ui.slot({ prepend: "sidebar.content", render: (props: any) => <Block {...props} /> })
	},
})
