// oc-budget — TUI half: slots and one command over the snapshot the server half publishes.
//
//   sidebar.content       the block: every wallet, the bars, the resets, the peak
//   prompt.footer.status  the paying wallet alone, appended — the doc, The footer
//   /budget               the full report in a dialog
//
// Nothing is fetched and no credential is handled here; the shape of the contract is the doc's, Two
// halves, one contract.
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createRoot, createSignal, Show } from "solid-js"
// The tariff is the same fact on both surfaces: `peak.ts` holds it, and these names are the ones the
// widget was written with.
import { clock, doubles as peakDoubles, isPeak as isDeepseekPeak, nextChange as nextRegimeChange } from "./peak.ts"
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"
import {
	DS_WARN_USD,
	GO_WARN_PERCENT,
	OR_WARN_USD,
	ZEN_WARN_USD,
	WALLET_NAME,
	WINDOW_LABEL,
	ageText,
	bindingWindow,
	connected,
	countdown,
	payingWallet,
	windowPercent,
	type GoWindowKey,
	type ModelRef,
	type Wallet,
} from "./budget.ts"

const REFRESH_MS = 5 * 60 * 1000

/** A stalled RPC must not leave the widget saying "reading…" for ever. The timer is cleared with the
 *  answer: a poll every five minutes would otherwise keep a fifteen-second timer around for nothing. */
const RPC_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`rpc timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}


/** Last-resort colours, used only when the active theme defines none of the token
 *  candidates below. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_RED = "#f85149"
const FALLBACK_DIM = "#8b949e"
const FALLBACK_TEXT = "#c9d1d9"
const FALLBACK_ACCENT = "#79c0ff"

/** md-speedometer, the budget slot's mark; mdi trending-up, the peak marker. Carried in
 *  the text rather than the row's icon so the widget reads the same wherever it lands. */
const BUDGET_GLYPH = "\u{f04c5}"
const PEAK_GLYPH = "\u{f0535}"

function bar(percent: number, cells: number): string {
	const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
	return "█".repeat(filled) + "░".repeat(cells - filled)
}

/** The sidebar's bars: ten cells in a panel this wide leaves half of it empty, and twenty still clear the
 *  percent — the widest row is `mo `, twenty cells, a space and `100%`. */
const SIDEBAR_BARS = 20

function usd(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—"
	return `$${value.toFixed(2)}`
}

/** A percent as the panel prints it — a dash, never a fake zero, when there is no number. */
function percentText(percent: number | null): string {
	return percent === null ? "—" : `${Math.round(percent)}%`
}

export default Plugin.define({
	id: "oc-budget.tui",
	setup(context: any) {
		// ---------------------------------------------------------------------------
		// Colours, resolved from the theme once, at setup
		// ---------------------------------------------------------------------------

		/** First candidate path the theme defines; the value is handed to `fg` as-is, because a theme
		 *  colour is the renderer's own type and not always a hex string. */
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}

		// Each role takes the first token the theme defines; the preference order and why it is that one are
		// the doc's, Colours come from the theme.
		const GREEN = themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ?? FALLBACK_GREEN
		const RED = themeColour(["diff", "text", "removed"], ["syntax", "keyword"], ["text", "feedback", "error", "base"]) ?? FALLBACK_RED
		const YELLOW = themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ?? FALLBACK_YELLOW
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
		/** The heading reads as ordinary text, not as a muted aside. */
		const TEXT = themeColour(["text", "base"]) ?? FALLBACK_TEXT
		/** The one accent for a *value* rather than a state: the workspace name, the blue oc-git gives the branch. */
		const ACCENT = themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT

		const rpc = context.client.rpc(Budget)
		const [snapshot, setSnapshot] = createRoot(() => createSignal<BudgetSnapshot | null>(null))
		const [ready, setReady] = createRoot(() => createSignal(false))
		/** Why the last read failed — what a silent failure looks like: the doc, The blank night. */
		const [failure, setFailure] = createRoot(() => createSignal<string | null>(null))

		const load = async (force: boolean) => {
			try {
				const next = await withTimeout(rpc.snapshot(force ? { force: true } : {}), RPC_TIMEOUT_MS)
				setSnapshot(next as BudgetSnapshot)
				setFailure(null)
			} catch (error) {
				// Keep the last good snapshot rather than blanking the widget — but say so.
				setFailure(error instanceof Error ? error.message : String(error))
			} finally {
				setReady(true)
			}
		}

		void load(true)
		const timer = setInterval(() => void load(false), REFRESH_MS)

		// A credential switch re-reads at once instead of waiting for the poll; the event names are matched
		// loosely, because a stray read is cheap behind the server's cache.
		let unsubscribe: (() => void) | undefined
		try {
			unsubscribe = context.data.listen((event: any) => {
				const type = String(event?.details?.type ?? event?.type ?? "")
				if (/credential|integration/.test(type)) void load(true)
			})
		} catch {
			// No event stream available: the poll still covers it.
		}

		// A model switch should land immediately: the wallet that pays can change with it.
		let lastModelKey = ""
		createRoot(() => {
			createEffect(() => {
				const current = context.ui.model.current()
				const key = `${current?.providerID ?? ""}/${current?.modelID ?? ""}`
				if (key === lastModelKey) return
				lastModelKey = key
				void load(true)
			})
		})

		const model = () => context.ui.model.current() as ModelRef | undefined

		/** Green, yellow from the alert threshold, red at the wall — the rule is the doc's, The four wallets. */
		const goColor = (percent: number | null): string => {
			if (percent === null) return DIM
			if (percent >= 100) return RED
			return percent >= GO_WARN_PERCENT ? YELLOW : GREEN
		}

		const balanceColor = (value: number | undefined, warn: number): string => {
			if (typeof value !== "number") return DIM
			if (value <= 0) return RED
			return value <= warn ? YELLOW : GREEN
		}

		/** The console's figure: spendable credit, which is the balance unless it went under. */
		const zenCredit = (zen: BudgetSnapshot["zen"]) => zen?.available ?? zen?.balance

		// ---------------------------------------------------------------------------
		// Rows
		// ---------------------------------------------------------------------------

		const Sidebar = () => {
			// A memo, not the body: the body runs once — the doc, Gotchas.
			const rows = createMemo(() => {
				const snap = snapshot()
				// The tariff's own window: it marks GO and DS whoever is paying — the doc, Peak marker.
				const atPeak = isDeepseekPeak(clock()) ? PEAK_GLYPH : ""
				const out: any[] = []

				if (!ready()) out.push(<text fg={DIM}>reading…</text>)
				// Two missed polls and these numbers are history, so they say so.
				const readAt = snap?.at
				if (typeof readAt === "number" && Date.now() - readAt > 2 * REFRESH_MS) {
					out.push(<text fg={YELLOW}>stale {ageText(Date.now() - readAt)}</text>)
				}
				if (ready() && !snap) out.push(<text fg={RED}>budget —</text>)
				if (failure()) out.push(<text fg={DIM}>{failure()}</text>)
				// A title with nothing under it is a promise — the doc, No provider connected.
				if (ready() && snap && !connected(snap)) {
					out.push(<text fg={DIM}>no provider connected</text>)
				}

				if (snap?.go && !snap.go.error) {
					// Three bars, one per window; the heading takes the colour of the first wall.
					const binding = bindingWindow(snap.go)
					out.push(
						<box flexDirection="row">
							<text fg={goColor(binding?.percent ?? null)}>GO</text>
							{atPeak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
					// Label, bar, percent, and the reset under the bar's own edge. The widths, the padding and
					// why they are those numbers are the doc's, The sidebar.
					const windowRow = (key: GoWindowKey, window: UsageWindow | undefined, gap: boolean) => {
						const percent = windowPercent(window)
						// No date is not no answer: the window just turned, which is what `now` says.
						const reset = countdown(window?.resetsAt) || (window ? "now" : "")
						out.push(
							<box flexDirection="row">
								<text fg={DIM}>{WINDOW_LABEL[key]} </text>
								<text fg={goColor(percent)}>
									{percent === null ? "—" : `${bar(percent, SIDEBAR_BARS)} ${percentText(percent)}`}
								</text>
							</box>,
						)
						if (reset) {
							out.push(
								// Under its own bar, left-aligned: the label's two cells and its space. The arrow
								// leads, because everything here is left-aligned — the doc, Desktop half.
								<box flexDirection="row" paddingLeft={3}>
									<text fg={DIM}>↻ {reset}</text>
								</box>,
							)
							// A blank row only after the last window: it is what separates the block from the
							// workspace, while the other two resets sit against the window that follows.
							if (gap) out.push(<box height={1} flexShrink={0} />)
						}
					}
					windowRow("rolling", snap.go.rolling, false)
					windowRow("weekly", snap.go.weekly, false)
					windowRow("monthly", snap.go.monthly, true)
					// The name only when the account has more than one connection — the doc, The sidebar.
					if (snap.zen?.org && (snap.zen.peers ?? 0) > 1) {
						out.push(
							<box flexDirection="row">
								<text fg={DIM}>workspace: </text>
								<text fg={ACCENT}>{snap.zen.org}</text>
							</box>,
						)
					}
					// The rule that closes the block: a window row's width, so it underlines the bars — the doc,
					// The sidebar.
					out.push(<text fg={DIM}>{"─".repeat(28)}</text>)
				} else if (snap?.go?.error) {
					out.push(<text fg={DIM}>GO —</text>)
					out.push(<text fg={DIM}>{snap.go.error}</text>)
				}

				// The name column is as wide as the longest name actually drawn, so figures line up without
				// assuming the panel's width.
				const money = [
					{
						name: WALLET_NAME.ds.long,
						wallet: snap?.ds,
						error: snap?.ds?.error,
						body: usd(snap?.ds?.balance),
						color: balanceColor(snap?.ds?.balance, DS_WARN_USD),
						mark: atPeak ? PEAK_GLYPH : "",
					},
					{
						name: WALLET_NAME.or.long,
						wallet: snap?.or,
						error: snap?.or?.error,
						body: usd(snap?.or?.balance),
						color: balanceColor(snap?.or?.balance, OR_WARN_USD),
						mark: "",
					},
					{
						name: WALLET_NAME.zen.long,
						wallet: snap?.zen,
						error: snap?.zen?.error,
						body: usd(zenCredit(snap?.zen)),
						color: balanceColor(zenCredit(snap?.zen), ZEN_WARN_USD),
						mark: "",
					},
				]
				const column = Math.max(0, ...money.filter((w) => w.wallet).map((w) => w.name.length))
				for (const w of money) {
					// Absent stays out: a dash would claim a reading.
					if (!w.wallet) continue
					if (w.error) {
						out.push(<text fg={DIM}>{`${w.name.padEnd(column)} —`}</text>)
						out.push(<text fg={DIM}>{w.error}</text>)
						continue
					}
					out.push(
						<box flexDirection="row">
							<text fg={w.color}>{`${w.name.padEnd(column)} ${w.body}`}</text>
							{w.mark ? <text fg={RED}> {w.mark}</text> : null}
						</box>,
					)
				}

				return out
			})

			return (
				<box flexDirection="column">
					<text fg={TEXT}>
						<span style={{ fg: DIM }}>{BUDGET_GLYPH} </span>
						<b>Budget</b>
					</text>
					{rows()}
				</box>
			)
		}

		/** Appended to the footer: that row is OpenCode's own and keeps the folder, the spinner and the esc
		 *  hint — the doc, The footer. */
		const Footer = () => {
			const budget = createMemo(() => {
				const snap = snapshot()
				const wallet = payingWallet(model())
				if (wallet === "none") return undefined
				// Absent wallet: nothing to say; a dash would claim a reading. No snapshot yet is not this case.
				if (snap && !snap[wallet]) return undefined
				if (wallet === "go") {
					// The month is the number; the colour is the wall that comes first — the doc, The footer.
					const percent = windowPercent(snap?.go?.monthly)
					return {
						color: goColor(bindingWindow(snap?.go)?.percent ?? null),
						body: percent === null ? "GO —" : `GO ${Math.round(percent)}%`,
						marker: peakDoubles(model(), wallet, clock()) ? PEAK_GLYPH : "",
					}
				}
				if (wallet === "zen") {
					return {
						color: balanceColor(zenCredit(snap?.zen), ZEN_WARN_USD),
						body: `${WALLET_NAME.zen.short} ${snap?.zen?.error ? "—" : usd(zenCredit(snap?.zen))}`,
						marker: "",
					}
				}
				if (wallet === "ds") {
					return {
						color: balanceColor(snap?.ds?.balance, DS_WARN_USD),
						body: `DS ${snap?.ds?.error ? "—" : usd(snap?.ds?.balance)}`,
						marker: peakDoubles(model(), wallet, clock()) ? PEAK_GLYPH : "",
					}
				}
				return {
					color: balanceColor(snap?.or?.balance, OR_WARN_USD),
					body: `OR ${snap?.or?.error ? "—" : usd(snap?.or?.balance)}`,
					marker: "",
				}
			})

			return (
				<box flexDirection="row" gap={2} flexShrink={0}>
					<Show when={budget()}>
						{(value: any) => (
							<box flexDirection="row" flexShrink={0}>
								{/* The glyph stays neutral and only the body carries the state, as in pi:
								    a coloured mark next to a coloured word would be two signals for one fact. */}
								<text fg={DIM} wrapMode="none">{BUDGET_GLYPH} </text>
								<text fg={value().color} wrapMode="none">{value().body}</text>
								<Show when={value().marker}>{(marker: any) => <text fg={RED} wrapMode="none"> {marker()}</text>}</Show>
							</box>
						)}
					</Show>
				</box>
			)
		}

		// ---------------------------------------------------------------------------
		// Report
		// ---------------------------------------------------------------------------

		/** The report, in the sidebar's own shapes: `/budget` is what answers when the panel is hidden, so it
		 *  carries the block and the detail the panel drops — the payer, the workspace, the credit ceiling,
		 *  Zen's debt, the clock (the doc, The report). */
		const Report = () => {
			const rows = createMemo(() => {
				const snap = snapshot()
				const wallet = payingWallet(model())
				const atPeak = isDeepseekPeak(clock())
				const out: any[] = []

				const label: Record<Wallet, string> = {
					go: "OpenCode — paying: GO (subscription)",
					zen: "OpenCode — paying: credits (prepaid, workspace-wide)",
					ds: "DeepSeek — paying: balance (pay-per-use, no quota windows)",
					or: "OpenRouter — paying: credit balance (pay-per-use, no quota windows)",
					none: "No budget provider selected",
				}
				// Two silences that are not the same: absent providers versus no wallet covering this model — the
				// doc, No provider connected.
				const nothing = !!snap && !connected(snap)
				out.push(<text fg={TEXT}>{nothing ? "No provider connected" : label[wallet]}</text>)
				if (snap?.zen?.org) {
					out.push(
						<box flexDirection="row">
							<text fg={DIM}>workspace: </text>
							<text fg={ACCENT}>{snap.zen.org}</text>
						</box>,
					)
				}
				out.push(<box height={1} flexShrink={0} />)
				if (nothing) {
					out.push(<text fg={DIM}>connect one with:  opencode auth login</text>)
					return out
				}

				if (snap?.go && !snap.go.error) {
					// The heading takes the colour of the first wall, as in the panel.
					const binding = bindingWindow(snap.go)
					out.push(
						<box flexDirection="row">
							<text fg={goColor(binding?.percent ?? null)}>GO</text>
							{atPeak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
					const windowRow = (key: GoWindowKey, window: UsageWindow | undefined, gap: boolean) => {
						const percent = windowPercent(window)
						// No date is not no answer: the window just turned, which is what `now` says.
						const reset = countdown(window?.resetsAt) || (window ? "now" : "")
						out.push(
							<box flexDirection="row">
								<text fg={DIM}>{WINDOW_LABEL[key]} </text>
								<text fg={goColor(percent)}>
									{percent === null ? "—" : `${bar(percent, SIDEBAR_BARS)} ${percentText(percent)}`}
								</text>
							</box>,
						)
						if (reset) {
							// The same line as the panel's: the arrow leads, because this column is left-aligned.
							out.push(
								<box flexDirection="row" paddingLeft={3}>
									<text fg={DIM}>↻ {reset}</text>
								</box>,
							)
							// Only the last window keeps the row that separates it from the workspace.
							if (gap) out.push(<box height={1} flexShrink={0} />)
						}
					}
					windowRow("rolling", snap.go.rolling, false)
					windowRow("weekly", snap.go.weekly, false)
					windowRow("monthly", snap.go.monthly, true)
					out.push(<text fg={DIM}>{"─".repeat(28)}</text>)
					out.push(<box height={1} flexShrink={0} />)
				} else if (snap?.go?.error) {
					out.push(<text fg={DIM}>GO —</text>)
					out.push(<text fg={DIM}>{snap.go.error}</text>)
					out.push(<text fg={DIM}>{"─".repeat(28)}</text>)
					out.push(<box height={1} flexShrink={0} />)
				}

				// The name column is as wide as the longest name actually drawn, as in the panel.
				const money = [
					{
						name: WALLET_NAME.ds.long,
						wallet: snap?.ds,
						error: snap?.ds?.error,
						body: usd(snap?.ds?.balance),
						color: balanceColor(snap?.ds?.balance, DS_WARN_USD),
						mark: atPeak ? PEAK_GLYPH : "",
						extra: [] as string[],
					},
					{
						name: WALLET_NAME.or.long,
						wallet: snap?.or,
						error: snap?.or?.error,
						body:
							snap?.or && !snap.or.error
								? `${usd(snap.or.balance)}${typeof snap.or.totalCredits === "number" ? ` of ${usd(snap.or.totalCredits)}` : ""}${typeof snap.or.totalUsage === "number" ? ` (used ${usd(snap.or.totalUsage)})` : ""}`
								: usd(snap?.or?.balance),
						color: balanceColor(snap?.or?.balance, OR_WARN_USD),
						mark: "",
						extra: [] as string[],
					},
					{
						name: WALLET_NAME.zen.long,
						wallet: snap?.zen,
						error: snap?.zen?.error,
						body: usd(zenCredit(snap?.zen)),
						color: balanceColor(zenCredit(snap?.zen), ZEN_WARN_USD),
						mark: "",
						// The clamped credit plus the ledger when the account is under — the doc, The four wallets.
						extra:
							typeof snap?.zen?.balance === "number" && snap.zen.balance < 0
								? [`(debt ${usd(-snap.zen.balance)})`]
								: ([] as string[]),
					},
				]
				const column = Math.max(0, ...money.filter((w) => w.wallet).map((w) => w.name.length))
				for (const w of money) {
					// Absent stays out: a dash would claim a reading.
					if (!w.wallet) continue
					if (w.error) {
						out.push(<text fg={DIM}>{`${w.name.padEnd(column)} —`}</text>)
						out.push(<text fg={DIM}>{w.error}</text>)
						continue
					}
					out.push(
						<box flexDirection="row">
							<text fg={w.color}>{`${w.name.padEnd(column)} ${w.body}`}</text>
							{w.mark ? <text fg={RED}> {w.mark}</text> : null}
						</box>,
					)
					for (const line of w.extra) {
						out.push(<text fg={DIM}>{" ".repeat(column + 1) + line}</text>)
					}
				}

				// The price regime only means something where the tariff moves.
				if (wallet === "ds" || (wallet === "go" && /^deepseek/.test(model()?.modelID ?? ""))) {
					const next = nextRegimeChange(clock())
					out.push(<box height={1} flexShrink={0} />)
					out.push(
						<box flexDirection="row">
							<text fg={DIM}>{"peak".padEnd(column + 1)}</text>
							<text fg={atPeak ? RED : GREEN}>{atPeak ? "PEAK — paying double" : "off-peak (half price)"}</text>
						</box>,
					)
					out.push(
						<box flexDirection="row">
							<text fg={DIM}>{"next".padEnd(column + 1)}</text>
							<text fg={DIM}>{`${next.peak ? "peak" : "off-peak"} in ${countdown(new Date(next.at).toISOString())}`}</text>
						</box>,
					)
				}

				if (snap?.at) {
					out.push(<box height={1} flexShrink={0} />)
					out.push(<text fg={DIM}>{`updated ${new Date(snap.at).toLocaleTimeString()}`}</text>)
				}
				return out
			})

			return (
				<box
					flexDirection="column"
					border={["top", "bottom", "left", "right"]}
					borderColor={DIM}
					paddingLeft={1}
					paddingRight={1}
				>
					<text wrapMode="none"> </text>
					<text fg={TEXT} wrapMode="none">
						<span style={{ fg: DIM }}>{BUDGET_GLYPH} </span>
						<b>Budget</b>
					</text>
					<text wrapMode="none"> </text>
					{rows()}
					<text wrapMode="none"> </text>
				</box>
			)
		}

		// ---------------------------------------------------------------------------
		// Slots and command
		// ---------------------------------------------------------------------------

		const sidebarSlot = context.ui.slot({ prepend: "sidebar.content", render: () => <Sidebar /> })
		context.ui.slot({ append: "prompt.footer.status", render: () => <Footer /> })

		context.keymap.layer(() => ({
			mode: "global",
			commands: [
				{
					id: "oc-budget.report",
					title: "Budget report",
					group: "Budget",
					palette: true,
					slash: { name: "budget", arguments: true },
					run: async (input?: string) => {
						await load((input ?? "").trim().toLowerCase() === "refresh")
						// `set` talks to the *active* dialog, so it follows `show` — the same pair
						// `oc-plugin-updates` uses.
						context.ui.dialog.show(() => <Report />)
						context.ui.dialog.set({ size: "medium", centered: true })
					},
				},
			],
		}))

		return () => {
			clearInterval(timer)
			unsubscribe?.()
			sidebarSlot?.()
		}
	},
})
