// oc-budget — TUI half.
//
// Two slots and one command, all reading the same snapshot the server half publishes:
//
//   sidebar.content       the rich view: every wallet, the bars, the resets, the peak
//   prompt.footer.status  the paying wallet alone — the context total is oc-context's
//   /budget               the full report in a dialog (a bar for each Go window, the
//                         OpenRouter region guardrail, the reset times, the peak regime)
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
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"

const REFRESH_MS = 5 * 60 * 1000

/** A stalled RPC must not leave the widget saying "reading…" for ever. */
const RPC_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`rpc timed out after ${ms}ms`)), ms)),
	])
}

// Thresholds, unchanged from pi-budget: the point at which the colour turns is a
// decision about consequence, not an estimate. Go alerts at 90% of the month; the Zen
// wallet at the console's own $5 auto-recharge threshold; DeepSeek at $2 and
// OpenRouter at $5 (its credits are bought in blocks and expire, so the useful warning
// is "time to top up" and $2 would fire too late to act on).
const GO_WARN_PERCENT = 90
const DS_WARN_USD = 2
const OR_WARN_USD = 5
const ZEN_WARN_USD = 5

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
const SHIELD_GLYPH = "\u{f0565}"

/** DeepSeek's peak windows, in UTC: 01:00-04:00 and 06:00-10:00, Mon-Fri. Everything
 *  else is half price. UTC is deliberate: it makes the arithmetic DST-proof. A Chinese
 *  public holiday is not encoded, so it reads as peak — over-warning, which is the safe
 *  direction. */
const PEAK_WINDOWS_UTC: ReadonlyArray<readonly [number, number]> = [
	[1, 4],
	[6, 10],
]
const PEAK_EDGES_UTC = [1, 4, 6, 10]

type Wallet = "go" | "zen" | "ds" | "or" | "none"

interface ModelRef {
	providerID?: string
	modelID?: string
	variant?: string
}

function isDeepseekPeak(at = Date.now()): boolean {
	const date = new Date(at)
	const day = date.getUTCDay()
	if (day === 0 || day === 6) return false
	const hour = date.getUTCHours() + date.getUTCMinutes() / 60
	return PEAK_WINDOWS_UTC.some(([from, to]) => hour >= from && hour < to)
}

/** The next instant the regime flips, and what it flips to. Candidates are the window
 *  edges over the next ten days; the first that actually changes the state wins, which
 *  skips the weekend edges that open and close nothing. */
function nextRegimeChange(at = Date.now()): { peak: boolean; at: number } {
	const now = isDeepseekPeak(at)
	const midnight = new Date(at)
	midnight.setUTCHours(0, 0, 0, 0)
	const edges: number[] = []
	for (let offset = 0; offset <= 10; offset++) {
		for (const hour of PEAK_EDGES_UTC) {
			const time = midnight.getTime() + offset * 86_400_000 + hour * 3_600_000
			if (time > at) edges.push(time)
		}
	}
	edges.sort((a, b) => a - b)
	for (const time of edges) if (isDeepseekPeak(time) !== now) return { peak: !now, at: time }
	return { peak: !now, at: edges[edges.length - 1] }
}

function bar(percent: number, cells = 10): string {
	const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
	return "█".repeat(filled) + "░".repeat(cells - filled)
}

function countdown(iso: string | undefined): string {
	if (!iso) return ""
	const target = Date.parse(iso)
	if (!Number.isFinite(target)) return ""
	const ms = target - Date.now()
	if (ms <= 0) return "now"
	const minutes = Math.floor(ms / 60_000)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 48) return `${hours}h ${minutes % 60}m`
	return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function usd(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—"
	return `$${value.toFixed(2)}`
}

function windowPercent(window: UsageWindow | undefined): number | null {
	return typeof window?.percent === "number" ? window.percent : null
}

/** A percent as the panel prints it — a dash, never a fake zero, when there is no number. */
function percentText(percent: number | null): string {
	return percent === null ? "—" : `${Math.round(percent)}%`
}

/** Which wallet pays, read from the model first: a Zen selection never uses the Go
 *  subscription however much of the quota is left, and a Go model falls back to the Zen
 *  balance once the month is exhausted. */
function payingWallet(model: ModelRef | undefined, snapshot: BudgetSnapshot | null): Wallet {
	const provider = model?.providerID ?? ""
	if (provider === "deepseek") return "ds"
	if (provider === "openrouter") return "or"
	if (provider === "opencode" || provider === "opencode-zen") return "zen"
	if (provider === "opencode-go") return snapshot?.go?.monthly?.status === "rate-limited" ? "zen" : "go"
	return "none"
}

/** True when the active model's price doubles inside a peak window: native DeepSeek, and
 *  the DeepSeek ids on Go while the subscription pays. Zen never does — its DeepSeek
 *  price is flat at the peak figure, a constant and not a doubling. */
function peakDoubles(model: ModelRef | undefined, wallet: Wallet): boolean {
	if (!isDeepseekPeak()) return false
	const provider = model?.providerID ?? ""
	if (provider === "deepseek") return true
	if (provider === "opencode-go" && wallet === "go") return /^deepseek/.test(model?.modelID ?? "")
	return false
}

/** True when OpenRouter's account regions pin something narrower than the default
 *  multi-region — the only place the guardrail is visible. */
function regionPinned(regions: string[] | undefined): boolean {
	return Array.isArray(regions) && !regions.includes("global")
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

		const load = async (force: boolean) => {
			try {
				const next = await withTimeout(rpc.snapshot(force ? { force: true } : {}), RPC_TIMEOUT_MS)
				setSnapshot(next as BudgetSnapshot)
			} catch {
				// Keep the last good snapshot rather than blanking the widget.
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
				const peak = peakDoubles(model(), payingWallet(model(), snap)) ? PEAK_GLYPH : ""
				const goPercent = windowPercent(snap?.go?.monthly)
				const out: any[] = []

				if (!ready()) out.push(<text fg={DIM}>reading…</text>)

				if (snap?.go && !snap.go.error) {
					out.push(
						<box flexDirection="row">
							<text fg={goColor(goPercent)}>GO</text>
							<text> </text>
							<text fg={goColor(goPercent)}>
								{goPercent === null ? "—" : `${bar(goPercent)} ${percentText(goPercent)}`}
							</text>
							{peak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
					out.push(
						<box flexDirection="row">
							<text fg={DIM}>5h </text>
							<text fg={goColor(windowPercent(snap.go.rolling))}>
								{percentText(windowPercent(snap.go.rolling))}
							</text>
							<text> </text>
							<text fg={DIM}>wk </text>
							<text fg={goColor(windowPercent(snap.go.weekly))}>
								{percentText(windowPercent(snap.go.weekly))}
							</text>
							<text> </text>
							<text fg={DIM}>mo </text>
							<text fg={goColor(goPercent)}>{percentText(goPercent)}</text>
						</box>,
					)
					const reset = countdown(snap.go.monthly?.resetsAt)
					if (reset) out.push(<text fg={DIM}>reset {reset}</text>)
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
					// measured: the panel does not know how wide the sidebar is. 20 columns clears every line the
					// block prints short of exhaustion — `5h 3% wk 1% mo 1%` is 17, two-digit percents 19; only
					// `5h 100% wk 100% mo 100%` (23) runs past it.
					out.push(<text fg={DIM}>{"─".repeat(20)}</text>)
				} else if (snap?.go?.error) {
					out.push(<text fg={DIM}>GO —</text>)
					out.push(<text fg={DIM}>{snap.go.error}</text>)
				}

				if (snap?.ds && !snap.ds.error) {
					out.push(
						<box flexDirection="row">
							<text fg={balanceColor(snap.ds.balance, DS_WARN_USD)}>DS {usd(snap.ds.balance)}</text>
							{peak ? <text fg={RED}> {PEAK_GLYPH}</text> : null}
						</box>,
					)
				} else if (snap?.ds?.error) {
					out.push(<text fg={DIM}>DS —</text>)
				}

				if (snap?.or && !snap.or.error) {
					out.push(
						<box flexDirection="row">
							<text fg={balanceColor(snap.or.balance, OR_WARN_USD)}>OR {usd(snap.or.balance)}</text>
							{regionPinned(snap.or.regions) ? <text fg={RED}> {SHIELD_GLYPH}</text> : null}
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
						marker: peakDoubles(model(), wallet) ? PEAK_GLYPH : "",
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
						marker: peakDoubles(model(), wallet) ? PEAK_GLYPH : "",
					}
				}
				return {
					color: balanceColor(snap?.or?.balance, OR_WARN_USD),
					body: `OR ${snap?.or?.error ? "—" : usd(snap?.or?.balance)}`,
					marker: regionPinned(snap?.or?.regions) ? SHIELD_GLYPH : "",
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
				if (Array.isArray(snap.or.regions)) {
					const enforcing = snap.or.regions.includes("global") ? "NOT enforcing" : "enforcing"
					lines.push(`  ${"regions".padEnd(8)} ${snap.or.regions.join(", ")} — guardrail ${enforcing}`)
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
				const next = nextRegimeChange()
				lines.push("")
				lines.push(`  ${"peak".padEnd(8)} ${isDeepseekPeak() ? "PEAK — paying double" : "off-peak (half price)"}`)
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
