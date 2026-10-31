// oc-budget — GUI half.
//
// One surface: the figure in the session header, beside the app's own context ring and session cost, where
// a reader already looks for what the session is costing. Its popover carries the whole block — every
// wallet, the Go bar, the resets, the workspace, the peak mark — the same lines the terminal draws.
//
// The mark is a ring only where a percentage exists: Go's month. ZEN, DS and OR are money, and a ring
// around money would imitate a share of a cap that does not exist, so their figure carries the colour and
// the name stays quiet. A slot gets no icons — `IconName` lives in pill and row fields, not in JSX — so
// there is no glyph to fall back on.
//
// Colours come from the theme, never from hex: a GUI plugin has no theme API, but the app publishes its
// tokens as CSS variables, and these are the three alert levels the terminal uses.
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

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
import type { Wallet } from "./budget.ts"
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
.ocb-head { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: none;
  color: var(--v2-text-text-faint); font: inherit; font-size: 13px; font-weight: 440; letter-spacing: -0.04px;
  font-variant-numeric: tabular-nums; cursor: pointer; anchor-name: --ocb-anchor; }
.ocb-head:hover { color: var(--v2-text-text-base, inherit); }
.ocb-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
.ocb-head-label { white-space: nowrap; color: inherit; }
/* The block, in the top layer: nothing clips it, and the platform owns Escape and the light dismiss. */
.ocb-pop { position: fixed; inset: auto; position-anchor: --ocb-anchor; top: anchor(--ocb-anchor bottom);
  right: anchor(--ocb-anchor right); margin: 6px 0 0; width: max-content; min-width: 16em;
  max-width: min(20em, calc(100vw - 16px)); padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--v2-border-border-muted, rgba(255, 255, 255, .12));
  background: var(--v2-background-bg-layer-02, #1b1b1b);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35); color: var(--v2-text-text-base, inherit); font-size: 12px; }
.ocb-pop:popover-open { display: block; }
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

/** What the header row and the popover both read: a session and its screen, and nothing else. */
type SurfaceInput = Pick<SlotMap["session.header"], "session" | "screen">

/** Everything both surfaces say, computed once. Reads the signals, so call it from JSX: the capsule is
 *  re-run by the host, the popover re-runs itself while open. */
type Figures = {
	ready: boolean
	error?: string
	label?: string
	capsuleTone?: Tone
	/** Which wallet pays: the ring is drawn where a share of a cap exists, the figure where money does. */
	wallet: Wallet
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

		const view = (input: SurfaceInput): Figures => {
			const current = snapshot()
			const error = failure()
			const model = input.screen.composer.model()
			const now = clock()
			// Two questions, two functions (`peak.ts`). `isPeak` is the tariff: GO and DS are marked whoever
			// pays, because the mark is the reminder not to switch *to* them. `doubles` is your own spend.
			const atPeak = isPeak(now)

			if (!current || current.server !== input.session.server.id) {
				return { ready: false, error, wallet: "none", stale: false, age: 0, atPeak, marked: false, ...NO_LINES }
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
				wallet,
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

		/** The block, wherever it is shown: the popover under the header figure. The same lines, the same
		 *  colours, the same order the terminal draws. */
		const Block = (props: { input: SurfaceInput }) => {
			const figures = createMemo(() => view(props.input))
			// The tick is five minutes, so open on a fresh read: one call, and the capsule follows it, because
			// both surfaces read this one signal.
			onMount(() => {
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

		/** The month's consumption as a ring, at the app's own geometry: an indicator circle is 16 px wide with a
		 *  2 px stroke and a radius of `8 - stroke/2`, so the two rings are the same circle and the same family. */
		const RING_STROKE = 2
		const RING_R = 8 - RING_STROKE / 2
		const RING_C = 2 * Math.PI * RING_R
		const Ring = (props: { percent: number | null }) => (
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<circle
					cx="8"
					cy="8"
					r={RING_R}
					stroke="currentColor"
					stroke-opacity="0.18"
					stroke-width={RING_STROKE}
				/>
				<circle
					cx="8"
					cy="8"
					r={RING_R}
					stroke="currentColor"
					stroke-width={RING_STROKE}
					stroke-dasharray={RING_C}
					stroke-dashoffset={RING_C * (1 - fill(props.percent) / 100)}
					transform="rotate(-90 8 8)"
				/>
			</svg>
		)

		/** The mark for a wallet that is money: a card, at the ring's size so the row keeps one rhythm. It is not a
		 *  share of anything, and a ring around money would read as a percentage that does not exist. */
		const WalletMark = () => (
			<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
				<rect x="2" y="4.5" width="12" height="8" rx="2" stroke="currentColor" stroke-width="1.6" />
				<path d="M2 7h12" stroke="currentColor" stroke-width="1.6" />
				<circle cx="11" cy="9.6" r="1.1" fill="currentColor" />
			</svg>
		)

		/** The figure in the session header, beside the app's own context ring and cost. The mark carries the
		 *  colour: a ring where a percentage exists, a card where the wallet is money. The popover is the
		 *  platform's — the top layer, the light dismiss and Escape come with it. */
		const HeaderBudget = (props: { input: SlotMap["session.header"] }) => {
			const figures = () => view(props.input)
			let panel: HTMLDivElement | undefined

			const toggle = () => {
				if (!panel) return
				// The tick is five minutes: open on a fresh read, as the capsule did.
				if (panel.matches(":popover-open")) panel.hidePopover()
				else {
					refreshNow?.()
					panel.showPopover()
				}
			}

			/** Nothing read yet is not an error; a failure with nothing behind it is one, and hiding it is what
			 *  cost a whole night — `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*. */
			const shown = () => {
				const f = figures()
				if (f.ready && f.label) {
					const tone = f.stale
						? "warning"
						: f.wallet === "go"
							? windowTone(f.go?.monthly ?? null)
							: f.capsuleTone
					return { f, text: f.label, tone: tone as Tone | undefined }
				}
				if (f.error) return { f, text: "budget", tone: "danger" as Tone }
				return undefined
			}

			return (
				<Show when={shown()}>
					{(s: () => NonNullable<ReturnType<typeof shown>>) => (
						<>
							<button
								type="button"
								class="ocb-head"
								aria-haspopup="dialog"
								title={
									s().f.error ??
									(s().f.stale ? `Budget · last read ${ageText(s().f.age)} ago` : "Budget")
								}
								onClick={toggle}
							>
								<span class={`ocb-mark ${cls(s().tone)}`}>
									<Show
										when={s().f.wallet === "go" && s().f.go}
										fallback={<WalletMark />}
									>
										{(g: () => NonNullable<Figures["go"]>) => <Ring percent={g().monthly} />}
									</Show>
								</span>
								<Show when={!props.input.compact}>
									<span class="ocb-head-label">
										{s().f.stale ? `~${s().text}` : s().text}
									</span>
								</Show>
								<Show when={s().f.marked}>
									<span class="ocb-head-label ocb-bad">{PEAK_MARK}</span>
								</Show>
							</button>
							<div ref={panel} class="ocb-pop" popover="auto">
								<Block input={props.input} />
							</div>
						</>
					)}
				</Show>
			)
		}

		ctx.add(Style, CSS)

		// One surface: the figure in the session header, where the app already draws its context ring and the
		// session's cost — `docs/gui-plugins.md`, *Where a contribution lands, by layout*. Order 11 puts it after
		// the app's figures (10) and before its actions (20), and the tie at 10 would have decided it by luck.
		ctx.add(Slot, { at: "session.header", order: 11, render: (input) => <HeaderBudget input={input} /> })
	},
})
