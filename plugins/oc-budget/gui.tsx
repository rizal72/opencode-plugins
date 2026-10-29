// oc-budget — GUI half.
//
// Two surfaces, the same two the terminal has: the capsule is the footer (which wallet pays, and whether
// *that* model's price doubles), and the popover is the sidebar block (every wallet, the bars, the reset,
// the workspace, and the peak mark on GO and DS whoever is paying).
//
// The block was impossible while a pill could only open `rows`: one line of text each, and a `tone` that
// paints the icon alone. The 2.2.1 `menu` gives the popover the plugin's own drawing, so the window can
// finally say what the terminal says — `docs/gui-plugins.md`, *the always-visible surfaces*.
//
// Colours come from the theme, never from hex: a GUI plugin has no theme API, but the app publishes its
// tokens as CSS variables, and these are the three alert levels the terminal uses.
import { ComposerPill, Plugin, Style, type ComposerPillMenuProps, type ComposerPillProps } from "@opencode/plugin/gui"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

import {
	DS_WARN_USD,
	GO_WARN_PERCENT,
	OR_WARN_USD,
	ZEN_WARN_USD,
	ageText,
	countdown,
	payingWallet,
	windowPercent,
} from "./budget.ts"
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot } from "./rpc.ts"
import { clock, doubles as peakDoubles, isPeak } from "./peak.ts"

/** The mark says "this tariff is in its doubled window"; the capsule adds it to the *paying* model only. */
const PEAK_MARK = "↗"

const REFRESH_MS = 5 * 60 * 1000
/** A failed poll is not a slow poll: ask again in half a minute, before the five-minute tick. */
const RETRY_MS = 30_000
/** Two missed polls: from here the numbers on screen are history, and the pill says so. */
const STALE_MS = 2 * REFRESH_MS
const RPC_TIMEOUT_MS = 15_000

const CSS = `
/* The host gives a menu's popover the composer's width, and nothing we set narrows it: so the rows fill it,
   the bar grows with it, and every figure right-aligns in one column. */
/* anywhere: the host fixes the width and clips nothing, so an unbreakable string — an error carrying a
   URL or a token — would paint outside the box. This is our content; the overflow is ours too. */
.ocb { display: flex; flex-direction: column; gap: 5px; width: 100%; font-size: 12px;
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ocb-line { display: flex; align-items: center; gap: 6px; }
.ocb-name { font-weight: 600; letter-spacing: .02em; min-width: 2.6em; }
.ocb-figure { margin-left: auto; min-width: 4.2em; text-align: right; }
.ocb-mark { margin-left: 4px; }
.ocb-windows { gap: 4px; font-size: 11px; }
.ocb-ok { color: var(--v2-state-fg-success, inherit); }
.ocb-warn { color: var(--v2-state-fg-warning, inherit); }
.ocb-bad { color: var(--v2-state-fg-danger, inherit); }
.ocb-dim { color: var(--v2-text-text-muted, inherit); font-size: 11px; }
.ocb-accent { color: var(--v2-text-text-accent, inherit); }
.ocb-bar { flex: 1 1 auto; min-width: 90px; height: 6px; border-radius: 3px; overflow: hidden;
  background: color-mix(in srgb, currentColor 16%, transparent); }
.ocb-fill { display: block; height: 100%; border-radius: 3px; background: currentColor; }
.ocb-rule { height: 1px; margin: 2px 0; background: color-mix(in srgb, currentColor 18%, transparent); }
`

type Tone = "success" | "warning" | "danger"

const CLASS: Record<Tone, string> = { success: "ocb-ok", warning: "ocb-warn", danger: "ocb-bad" }
const cls = (tone: Tone | undefined) => (tone ? CLASS[tone] : "")

/** A stalled call must not leave the pill frozen: the guard resets only when the promise settles. */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("rpc timeout")), ms)
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

const usd = (value: number | undefined) =>
	typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—"

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value)}%`)

/** The bar's width: a percent clamped to its track, because the value can overshoot and never undershoot. */
const fill = (value: number | null) => Math.max(0, Math.min(100, value ?? 0))

/** Red at the wall, yellow past the threshold, green elsewhere — the answer is the same for a percent
 *  and for a balance, only the wall differs. */
const tone = (value: number | null, warn: number, empty: number): Tone | undefined => {
	if (value === null) return undefined
	if (value <= empty) return "danger"
	return value <= warn ? "warning" : "success"
}

/** A quota window's colour, as the terminal draws it: done at 100, alert at the threshold. */
const windowTone = (value: number | null): Tone | undefined => {
	if (value === null) return undefined
	if (value >= 100) return "danger"
	return value >= GO_WARN_PERCENT ? "warning" : "success"
}

type Line = { figure?: number; tone?: Tone; note?: string }

/** Everything both surfaces say, computed once. Reads the signals, so call it from JSX: the capsule is
 *  re-run by the host, the popover re-runs itself while open. */
type Figures = {
	ready: boolean
	error?: string
	label?: string
	capsuleTone?: Tone
	stale: boolean
	age: number
	atPeak: boolean
	marked: boolean
	go?: {
		rolling: number | null
		weekly: number | null
		monthly: number | null
		resets: { rolling: string; weekly: string; monthly: string }
		error?: string
	}
	workspace?: string
	ds: Line
	or: Line
	zen: Line
}

const NO_LINES: Pick<Figures, "ds" | "or" | "zen"> = {
	ds: {},
	or: {},
	zen: {},
}

export default Plugin.define({
	setup(ctx) {
		const [snapshot, setSnapshot] = createSignal<{ server: string; value: BudgetSnapshot } | undefined>(
			undefined,
		)
		/** Why the last read failed, and nothing else: cleared by the next good one. */
		const [failure, setFailure] = createSignal<string | undefined>(undefined)
		let timer: ReturnType<typeof setInterval> | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let reading: string | undefined
		/** The current server's read, for the popover: opening it must not show a figure from five minutes ago. */
		let refreshNow: (() => void) | undefined

		// One poll per server, on that server's own client: the credential lives where the plugin runs, and a
		// server that does not run it has nothing to answer.
		createEffect(() => {
			const session = ctx.sessions.current()
			const server = session?.server.id

			if (timer) clearInterval(timer)
			if (retry) clearTimeout(retry)
			timer = undefined
			retry = undefined
			refreshNow = undefined
			// Another server's failure is not this session's: the effect re-runs when the routing moves.
			setFailure(undefined)
			if (!server) {
				setSnapshot(undefined)
				return
			}

			const refresh = () => {
				if (reading === server) return
				reading = server
				void withTimeout(session!.server.client.rpc(Budget).snapshot({}), RPC_TIMEOUT_MS)
					.then((value) => {
						// A slow answer from the server that was polled before must not overwrite this one.
						if (ctx.sessions.current()?.server.id !== server) return
						setSnapshot({ server, value: value as BudgetSnapshot })
						setFailure(undefined)
					})
					.catch((error: unknown) => {
						// Keep the last good reading: a failed poll says nothing about the balance, and
						// blanking the pill for five minutes cost a whole night (measured 2026-10-28, the
						// pill gone from 07:00 to 12:26, every poll a fast 500). Ask again sooner instead.
						if (ctx.sessions.current()?.server.id !== server) return
						setFailure(error instanceof Error ? error.message : String(error))
						if (retry) clearTimeout(retry)
						retry = setTimeout(refresh, RETRY_MS)
					})
					.finally(() => {
						if (reading === server) reading = undefined
					})
			}

			refreshNow = refresh
			refresh()
			timer = setInterval(refresh, REFRESH_MS)
		})

		onCleanup(() => {
			if (timer) clearInterval(timer)
			if (retry) clearTimeout(retry)
		})

		const view = (input: ComposerPillProps): Figures => {
			const current = snapshot()
			const error = failure()
			const model = input.screen.composer.model()
			const now = clock()
			// Two questions, two functions (`peak.ts`). `isPeak` is the tariff: GO and DS are marked whoever
			// pays, because the mark is the reminder not to switch *to* them. `doubles` is your own spend.
			const atPeak = isPeak(now)

			if (!current || current.server !== input.session.server.id) {
				return { ready: false, error, stale: false, age: 0, atPeak, marked: false, ...NO_LINES }
			}

			const value = current.value
			const wallet = payingWallet(model, value)
			const go = value.go
			const rolling = windowPercent(go?.rolling)
			const weekly = windowPercent(go?.weekly)
			const monthly = windowPercent(go?.monthly)
			const zen = value.zen?.available ?? value.zen?.balance
			const age = Date.now() - value.at

			const label =
				wallet === "go"
					? `GO · ${percent(monthly)}`
					: wallet === "zen"
						? `ZEN · ${usd(zen)}`
						: wallet === "ds"
							? `DS · ${usd(value.ds?.balance)}`
							: wallet === "or"
								? `OR · ${usd(value.or?.balance)}`
								: undefined

			const goTone = [rolling, weekly, monthly].some((figure) => figure !== null && figure >= 100)
				? "danger"
				: [rolling, weekly, monthly].some(
							(figure) => figure !== null && figure >= GO_WARN_PERCENT,
						)
					? "warning"
					: "success"
			const capsuleTone: Tone | undefined =
				wallet === "go"
					? goTone
					: wallet === "zen"
						? tone(zen ?? null, ZEN_WARN_USD, 0)
						: wallet === "ds"
							? tone(value.ds?.balance ?? null, DS_WARN_USD, 0)
							: tone(value.or?.balance ?? null, OR_WARN_USD, 0)

			return {
				ready: true,
				error,
				label,
				capsuleTone,
				stale: age > STALE_MS,
				age,
				atPeak,
				marked: peakDoubles(model, wallet, now),
				go: go
					? {
							rolling,
							weekly,
							monthly,
							// One reset per window, as the block prints them: the monthly one alone said nothing
							// about the two shorter windows that empty first.
							resets: {
								rolling: countdown(go.rolling?.resetsAt),
								weekly: countdown(go.weekly?.resetsAt),
								monthly: countdown(go.monthly?.resetsAt),
							},
							error: go.error,
						}
					: undefined,
				// The block says the workspace only when the account has peers: alone in it, the name says nothing.
				workspace: value.zen?.org && (value.zen.peers ?? 0) > 1 ? value.zen.org : undefined,
				ds: { figure: value.ds?.balance, tone: tone(value.ds?.balance ?? null, DS_WARN_USD, 0), note: value.ds?.error },
				or: {
					figure: value.or?.balance,
					tone: tone(value.or?.balance ?? null, OR_WARN_USD, 0),
					note: value.or?.error,
				},
				zen: { figure: zen, tone: tone(zen ?? null, ZEN_WARN_USD, 0), note: value.zen?.error },
			}
		}

		/** One window: its percent on its own colour, its reset on the right, as the block prints them. */
		const WindowRow = (props: { label: string; percent: number | null; reset: string }) => (
			<div class="ocb-line ocb-windows">
				<span class="ocb-dim">{props.label}</span>
				<span class={cls(windowTone(props.percent))}>{percent(props.percent)}</span>
				<Show when={props.reset}>
					<span class="ocb-dim ocb-figure">reset {props.reset}</span>
				</Show>
			</div>
		)

		const WalletLine = (props: { name: string; line: Line; mark?: string }) => (
			<>
				<div class="ocb-line">
					<span class={`ocb-name ${cls(props.line.tone)}`}>{props.name}</span>
					<span class={`ocb-figure ${cls(props.line.tone)}`}>{usd(props.line.figure)}</span>
					<Show when={props.mark}>
						<span class="ocb-bad ocb-mark">{props.mark}</span>
					</Show>
				</div>
				<Show when={props.line.note}>
					<div class="ocb-dim">{props.line.note}</div>
				</Show>
			</>
		)

		/** The sidebar block, in the window: the same lines, the same colours, the same order. */
		const Popover = (props: { input: ComposerPillMenuProps }) => {
			const figures = createMemo(() => view(props.input))
			// The tick is five minutes, so open on a fresh read: one call, and the capsule follows it, because
			// both surfaces read this one signal.
			createEffect(() => {
				refreshNow?.()
			})

			return (
				<div class="ocb">
					<Show
						when={figures().ready ? figures() : undefined}
						fallback={<div class="ocb-dim">{figures().error ?? "reading…"}</div>}
					>
						{(f: () => Figures) => (
							<>
								<Show when={f().stale}>
									<div class="ocb-warn">stale {ageText(f().age)}</div>
								</Show>
								<Show when={f().error}>
									<div class="ocb-dim">{f().error}</div>
								</Show>
								<Show when={f().go}>
									{(g: () => NonNullable<Figures["go"]>) => (
										<>
											<div class="ocb-line">
												<span class={`ocb-name ${cls(windowTone(g().monthly))}`}>GO</span>
												<span
													class={`ocb-bar ${cls(windowTone(g().monthly))}`}
													role="progressbar"
													aria-valuenow={fill(g().monthly)}
													aria-valuemin={0}
													aria-valuemax={100}
												>
													<span
														class="ocb-fill"
														style={{ width: `${fill(g().monthly)}%` }}
													/>
												</span>
												<span class={`ocb-figure ${cls(windowTone(g().monthly))}`}>
													{percent(g().monthly)}
												</span>
												<Show when={f().atPeak}>
													<span class="ocb-bad ocb-mark">{PEAK_MARK}</span>
												</Show>
											</div>
											<Show
												when={!g().error}
												fallback={<div class="ocb-dim">{g().error}</div>}
											>
												<WindowRow label="5h" percent={g().rolling} reset={g().resets.rolling} />
												<WindowRow label="wk" percent={g().weekly} reset={g().resets.weekly} />
												<WindowRow label="mo" percent={g().monthly} reset={g().resets.monthly} />
											</Show>
										</>
									)}
								</Show>
								<Show when={f().workspace}>
									<div class="ocb-line">
										<span class="ocb-dim">workspace</span>
										<span class="ocb-accent ocb-figure">{f().workspace}</span>
									</div>
								</Show>
								<div class="ocb-rule" />
								<WalletLine name="DS" line={f().ds} mark={f().atPeak ? PEAK_MARK : ""} />
								<WalletLine name="OR" line={f().or} />
								<WalletLine name="ZEN" line={f().zen} />
							</>
						)}
					</Show>
				</div>
			)
		}

		ctx.add(Style, CSS)

		ctx.add(ComposerPill, {
			id: "budget",
			order: 15,
			menu: (input) => <Popover input={input} />,
			show: (input) => {
				const figures = view(input)

				if (!figures.ready) {
					// Nothing read yet is not an error — a fresh window starts here. But a failure with no
					// reading behind it is one, and hiding it is what cost a whole night: three states,
					// never two. `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*.
					if (!figures.error) return undefined
					return {
						label: "budget",
						icon: "circle-exclamation" as const,
						tone: "danger" as const,
						title: figures.error,
					}
				}

				// Nothing pays: a pill that says nothing is worse than no pill.
				if (!figures.label) return undefined

				const text = figures.marked ? `${figures.label} ${PEAK_MARK}` : figures.label
				return {
					label: figures.stale ? `~${text}` : text,
					icon: "providers" as const,
					tone: figures.stale ? ("warning" as const) : figures.capsuleTone,
					title: figures.stale ? `Budget · last read ${ageText(figures.age)} ago` : "Budget",
				}
			},
		})
	},
})
