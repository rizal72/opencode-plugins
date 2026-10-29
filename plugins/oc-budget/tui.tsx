// oc-budget — TUI half.
//
// Two slots and one command, all reading the same snapshot the server half publishes:
//
//   sidebar.content       the rich view: every wallet, the bars, the resets, the peak
//   prompt.footer.status  the paying wallet alone — the context total is oc-context's
//   /budget               the full report in a dialog (a bar for each Go window, the
//                         reset times, the peak regime)
//
// The footer is only appended to, never taken over: that row also holds the project folder,
// the working spinner and the esc hint, and giving them up for one string is a bad trade.
//
// The numbers come from the server plugin over RPC; nothing is fetched here and no
// credential is ever handled here. Which wallet *pays* is the only decision this half
// makes, because it is the only half that knows the selected model.
//
// Solid owns the reactivity, and a component body runs exactly once: every value that
// depends on the snapshot or on the model is read inside a `createMemo` (or inside JSX),
// never in the body. Reading it in the body is how the first version froze on
// "reading…" for ever.
//
// Colours come from the theme, never from hard-coded hex: the theme has no
// success/warning/error tokens for plugins, so the alert levels are taken from the
// nearest semantic hues it does expose (`diff.added` / `diff.removed`) and fall back to
// fixed values only if a theme does not define them.
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
	ageText,
	countdown,
	payingWallet,
	windowPercent,
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

function bar(percent: number, cells = 10): string {
	const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
	return "█".repeat(filled) + "░".repeat(cells - filled)
}

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

		/** First candidate path the theme actually defines. The value is handed to `fg`
		 *  as-is: theme colours are the renderer's own colour type, not always hex strings. */
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}

		// Colours come from the theme, never from a hex literal: each role takes the first token the
		// theme defines. Green and red lean on the diff pair, the one hue every theme guarantees;
		// yellow takes the theme's own warning semantics first, because no syntax hue is reliably
		// warm. Hex only when a theme defines none of the candidates.
		const GREEN = themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ?? FALLBACK_GREEN
		const RED = themeColour(["diff", "text", "removed"], ["syntax", "keyword"], ["text", "feedback", "error", "base"]) ?? FALLBACK_RED
		const YELLOW = themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ?? FALLBACK_YELLOW
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
		/** The heading and the glyph read as ordinary text, not as a muted aside. */
		const TEXT = themeColour(["text", "base"]) ?? FALLBACK_TEXT
		/** The one accent for a *value* rather than a state — the workspace name, the same blue as the
		 *  branch in oc-git: `syntax.function` is the identity hue in most themes. */
		const ACCENT = themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT

		const rpc = context.client.rpc(Budget)
		const [snapshot, setSnapshot] = createRoot(() => createSignal<BudgetSnapshot | null>(null))
		const [ready, setReady] = createRoot(() => createSignal(false))
		/** Why the last read failed. Kept, because a failed read used to be indistinguishable from a
		 *  fresh one: the panel showed the previous numbers and said nothing (eleven hours, 2026-10-27). */
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

		// An account switch is a credential change on the server; picking it up from the
		// event stream makes the widget follow the switch at once instead of waiting for
		// the next poll. The exact event names are not relied on — anything mentioning a
		// credential or an integration re-reads (the server caches, so a stray one is cheap).
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

		/** Go window colour: green normally, yellow from the alert threshold, red once the window
		 *  is exhausted — the quota is spent and the gateway has fallen back to the Zen balance,
		 *  the same "nothing left" the other wallets report in red at zero. */
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
			// A memo, not the body: the body runs once, the memo re-runs on every
			// snapshot/model change and rebuilds the rows from the current values.
			const rows = createMemo(() => {
				const snap = snapshot()
				// Two questions, two functions (`peak.ts`). This block answers "is the tariff in its doubled
				// window": it marks GO and DS whatever is paying, because the mark is the reminder not to
				// switch *to* them now. `doubles` answers "is the model in front of me paying double", and
				// that is the footer's and the capsule's job.
				const atPeak = isDeepseekPeak(clock()) ? PEAK_GLYPH : ""
				const goPercent = windowPercent(snap?.go?.monthly)
				const out: any[] = []

				if (!ready()) out.push(<text fg={DIM}>reading…</text>)
				// A reading older than two polls is not fresh, and saying so is the difference between
				// "the numbers" and "the numbers from an hour ago".
				const readAt = snap?.at
				if (typeof readAt === "number" && Date.now() - readAt > 2 * REFRESH_MS) {
					out.push(<text fg={YELLOW}>stale {ageText(Date.now() - readAt)}</text>)
				}
				if (ready() && !snap) out.push(<text fg={RED}>budget —</text>)
				if (failure()) out.push(<text fg={DIM}>{failure()}</text>)

				if (snap?.go && !snap.go.error) {
					out.push(
						<box flexDirection="row">
							<text fg={goColor(goPercent)}>GO</text>
							<text> </text>
							<text fg={goColor(goPercent)}>
								{goPercent === null ? "—" : `${bar(goPercent)} ${percentText(goPercent)}`}
							</text>
							{atPeak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
					// One line per window, its reset on the same line: three counters side by side plus three
					// countdowns would need ~45 columns and this panel does not know the sidebar's width, so
					// the block grows down instead of across. The percent is padded to five so the resets line
					// up; the widest row is `mo 100%  reset 24d 3h`, 21 columns.
					const windowRow = (label: string, percent: number | null, resetsAt: string | undefined) => {
						const reset = countdown(resetsAt)
						return (
							<box flexDirection="row">
								<text fg={DIM}>{label} </text>
								<text fg={goColor(percent)}>{percentText(percent).padEnd(5)}</text>
								{reset ? <text fg={DIM}>reset {reset}</text> : null}
							</box>
						)
					}
					out.push(windowRow("5h", windowPercent(snap.go.rolling), snap.go.rolling?.resetsAt))
					out.push(windowRow("wk", windowPercent(snap.go.weekly), snap.go.weekly?.resetsAt))
					out.push(windowRow("mo", goPercent, snap.go.monthly?.resetsAt))
					// After the reset, as a line of its own: the label dim, the name in the accent oc-git uses
					// for the branch.
					if (snap.zen?.org && (snap.zen.peers ?? 0) > 1) {
						out.push(
							<box flexDirection="row">
								<text fg={DIM}>workspace: </text>
								<text fg={ACCENT}>{snap.zen.org}</text>
							</box>,
						)
					}
					// A dim rule closes the Go block, so the wallets below read as a separate group. Fixed, not
					// measured: the panel does not know how wide the sidebar is, and 20 columns is the width every
					// line clears short of exhaustion — a window row at 100% with a day-scale reset reaches 21.
					out.push(<text fg={DIM}>{"─".repeat(20)}</text>)
				} else if (snap?.go?.error) {
					out.push(<text fg={DIM}>GO —</text>)
					out.push(<text fg={DIM}>{snap.go.error}</text>)
				}

				if (snap?.ds && !snap.ds.error) {
					out.push(
						<box flexDirection="row">
							<text fg={balanceColor(snap.ds.balance, DS_WARN_USD)}>DS {usd(snap.ds.balance)}</text>
							{atPeak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
				} else if (snap?.ds?.error) {
					out.push(<text fg={DIM}>DS —</text>)
				}

				if (snap?.or && !snap.or.error) {
					out.push(
						<box flexDirection="row">
							<text fg={balanceColor(snap.or.balance, OR_WARN_USD)}>OR {usd(snap.or.balance)}</text>
						</box>,
					)
				} else if (snap?.or?.error) {
					out.push(<text fg={DIM}>OR —</text>)
				}

				if (snap?.zen && !snap.zen.error) {
					out.push(
						<text fg={balanceColor(zenCredit(snap.zen), ZEN_WARN_USD)}>ZEN {usd(zenCredit(snap.zen))}</text>,
					)
				} else if (snap?.zen?.error) {
					out.push(<text fg={DIM}>ZEN —</text>)
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

		/** Appended to the footer, and the footer stays OpenCode's own: the folder (which is
		 *  clickable), the working spinner, the esc hint, the usage, the cost and the
		 *  shortcuts are all native. Taking that row over was tried and gave every one of
		 *  them up for a single string, so what we add is the paying wallet alone. */
		const Footer = () => {
			const budget = createMemo(() => {
				const snap = snapshot()
				const wallet = payingWallet(model(), snap)
				if (wallet === "none") return undefined
				if (wallet === "go") {
					const percent = windowPercent(snap?.go?.monthly)
					return {
						color: goColor(percent),
						body: percent === null ? "GO —" : `GO ${Math.round(percent)}%`,
						marker: peakDoubles(model(), wallet, clock()) ? PEAK_GLYPH : "",
					}
				}
				if (wallet === "zen") {
					return {
						color: balanceColor(zenCredit(snap?.zen), ZEN_WARN_USD),
						body: `ZEN ${snap?.zen?.error ? "—" : usd(zenCredit(snap?.zen))}`,
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

		function report(): string {
			const snap = snapshot()
			const wallet = payingWallet(model(), snap)
			const lines: string[] = []

			const label: Record<Wallet, string> = {
				go: "OpenCode — paying: GO (subscription)",
				zen: "OpenCode — paying: ZEN (pay-per-use balance)",
				ds: "DeepSeek — paying: balance (pay-per-use, no quota windows)",
				or: "OpenRouter — paying: credit balance (pay-per-use, no quota windows)",
				none: "No budget provider selected",
			}
			lines.push(label[wallet])
			if (snap?.zen?.org) lines.push(`workspace: ${snap.zen.org}`)
			lines.push("")

			// `pays` is true for the monthly window only: that is the window the paying wallet rule
			// reads, so flagging an exhausted five-hour window would claim ZEN pays when it does not.
			const goWindow = (name: string, window: UsageWindow | undefined, pays: boolean) => {
				if (!window || typeof window.percent !== "number") return `  ${name.padEnd(8)} (no data)`
				const percent = Math.round(window.percent)
				const reset = countdown(window.resetsAt)
				const flag = pays && window.status === "rate-limited" ? "  ZEN paying" : ""
				return `  ${name.padEnd(8)} ${bar(percent)} ${String(percent).padStart(3)}%${reset ? `  reset in ${reset}` : ""}${flag}`
			}

			if (snap?.go && !snap.go.error) {
				lines.push(goWindow("5h", snap.go.rolling, false))
				lines.push(goWindow("weekly", snap.go.weekly, false))
				lines.push(goWindow("monthly", snap.go.monthly, true))
			} else if (snap?.go?.error) {
				lines.push(`  ${"go".padEnd(8)} ${snap.go.error}`)
			}

			if (snap?.ds && !snap.ds.error) {
				lines.push(`  ${"deepseek".padEnd(8)} ${usd(snap.ds.balance)}`)
			} else if (snap?.ds?.error) {
				lines.push(`  ${"deepseek".padEnd(8)} ${snap.ds.error}`)
			}

			if (snap?.or && !snap.or.error) {
				const of = typeof snap.or.totalCredits === "number" ? ` of ${usd(snap.or.totalCredits)}` : ""
				const used = typeof snap.or.totalUsage === "number" ? `   (used ${usd(snap.or.totalUsage)})` : ""
				lines.push(`  ${"openrouter".padEnd(8)} ${usd(snap.or.balance)}${of}${used}`)
				if (typeof snap.or.usageMonthly === "number") {
					lines.push(`  ${"".padEnd(8)} month ${usd(snap.or.usageMonthly)}`)
				}
			} else if (snap?.or?.error) {
				lines.push(`  ${"openrouter".padEnd(8)} ${snap.or.error}`)
			}

			if (snap?.zen && !snap.zen.error) {
				// The console's figure, with the ledger beside it only when the account is under: the
				// clamped credit would hide those cents, and they are spent money, not a rounding.
				const debt = snap.zen.balance !== undefined && snap.zen.balance < 0 ? `  (debt ${usd(-snap.zen.balance)})` : ""
				lines.push(`  ${"zen".padEnd(8)} ${usd(zenCredit(snap.zen))}${debt}`)
			} else if (snap?.zen?.error) {
				lines.push(`  ${"zen".padEnd(8)} ${snap.zen.error}`)
			}

			// The price regime only means something where the tariff moves.
			if (wallet === "ds" || (wallet === "go" && /^deepseek/.test(model()?.modelID ?? ""))) {
				const next = nextRegimeChange(clock())
				lines.push("")
				lines.push(`  ${"peak".padEnd(8)} ${isDeepseekPeak(clock()) ? "PEAK — paying double" : "off-peak (half price)"}`)
				lines.push(
					`  ${"next".padEnd(8)} ${next.peak ? "peak" : "off-peak"} in ${countdown(new Date(next.at).toISOString())}`,
				)
			}

			if (snap?.at) {
				lines.push("")
				lines.push(`  updated ${new Date(snap.at).toLocaleTimeString()}`)
			}
			return lines.join("\n")
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
						await context.ui.dialog.alert({ title: `${BUDGET_GLYPH} Budget`, message: report() })
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
