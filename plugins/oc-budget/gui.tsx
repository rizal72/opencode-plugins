// oc-budget — GUI half.
//
// One surface: the figure in the session header, beside the app's own context ring and session cost, where
// a reader already looks for what the session is costing. Its popover carries the whole block — every
// wallet, the Go bar, the resets, the workspace, the peak mark — the same lines the terminal draws.
//
// The mark is a ring only where a percentage exists: Go's month. ZEN, DS and OR are money, and a ring
// around money would imitate a share of a cap that does not exist, so their figure carries the colour and
// the name stays quiet. The app's catalog has no money glyph — `providers` says provider, not money — so the
// card is drawn here; `ctx.ui.Icon` supplies the warning one.
//
// Colours come from the theme, never from hex: a GUI plugin has no theme API, but the app publishes its
// tokens as CSS variables, and these are the three alert levels the terminal uses.
import { Plugin, Slot, Style, createKeyed, type SlotMap } from "@opencode/plugin/gui"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

import {
	DS_WARN_USD,
	GO_WARN_PERCENT,
	OR_WARN_USD,
	ZEN_WARN_USD,
	ageText,
	connected,
	countdown,
	payingWallet,
	windowPercent,
} from "./budget.ts"
import type { Wallet } from "./budget.ts"
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot } from "./rpc.ts"
import { HeaderMenu } from "./header-menu.tsx"
import { clock, doubles as peakDoubles, isPeak } from "./peak.ts"

/** The mark says "this tariff is in its doubled window"; the figure adds it to the *paying* model only. */
const PEAK_MARK = "↗"

const REFRESH_MS = 5 * 60 * 1000
/** A provider change never forces a read on a reading younger than this. Five seconds covers a bounce of the
 *  catalog at startup and nothing more: a person who switches a workspace and comes back takes longer, and that
 *  return is exactly when the reading behind them is the other account's. Measured at thirty on 2026-11-01,
 *  where the return arrived inside the guard and showed the expired workspace's error under the paying one. */
const PROVIDER_SWITCH_MS = 5_000

/** A failed poll is not a slow poll: ask again in half a minute, before the five-minute tick. */
const RETRY_MS = 30_000
/** Two missed polls: from here the numbers on screen are history, and the figure says so. */
const STALE_MS = 2 * REFRESH_MS
const RPC_TIMEOUT_MS = 15_000

const CSS = `
/* The block that opens from the header figure wears that figure's own type: one size, 13px, weight 440, the
   app's tight tracking. Hierarchy here is colour and weight, never a second size. */
/* anywhere: an error carrying a URL or a token must not paint outside the box. This is our content; the
   overflow is ours too. */
.ocb { display: flex; flex-direction: column; gap: 5px; width: 100%; font-size: 13px; font-weight: 440;
  letter-spacing: -0.04px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ocb-line { display: flex; align-items: center; gap: 6px; }
.ocb-name { font-weight: 600; letter-spacing: .02em; min-width: 2.6em; }
.ocb-figure { margin-left: auto; min-width: 4.2em; text-align: right; }
.ocb-peak { margin-left: 4px; }
.ocb-windows { gap: 4px; }
.ocb-ok { color: var(--v2-state-fg-success, inherit); }
.ocb-warn { color: var(--v2-state-fg-warning, inherit); }
.ocb-bad { color: var(--v2-state-fg-danger, inherit); }
.ocb-dim { color: var(--v2-text-text-muted, inherit); }
/* The empty state's two lines only: the words are short and the panel is 18em wide, so left-aligned they
   leave a column of dead space under the figure they belong to. They sit against the same edge the figure
   does, and nothing else in this plugin is right-aligned. */
.ocb-empty { text-align: right; }
.ocb-accent { color: var(--v2-text-text-accent, inherit); }
.ocb-bar { flex: 1 1 auto; min-width: 90px; height: 6px; border-radius: 3px; overflow: hidden;
  background: color-mix(in srgb, currentColor 16%, transparent); }
.ocb-fill { display: block; height: 100%; border-radius: 3px; background: currentColor; }
.ocb-rule { height: 1px; margin: 2px 0; background: color-mix(in srgb, currentColor 18%, transparent); }
/* The app's own toolbar button, hand-written: its height and its hover plate are what make the figure read as
   one of the header's controls. */
.ocb-head { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 6px; border: 0;
  border-radius: 6px; background: none; color: var(--v2-text-text-faint); font: inherit; font-size: 13px;
  font-weight: 440; letter-spacing: -0.04px; font-variant-numeric: tabular-nums; cursor: pointer; }
.ocb-head:hover, .ocb-head:focus-visible {
  background: color-mix(in srgb, var(--v2-text-text-base) 8%, transparent);
  color: var(--v2-text-text-base);
}
/* Two classes, so the open plate outranks the hover plate while the pointer still rests on the trigger. */
.ocb-head.ocb-head-on {
  background: color-mix(in srgb, var(--v2-text-text-base) 12%, transparent);
  color: var(--v2-text-text-base);
}
.ocb-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
.ocb-head-label { white-space: nowrap; color: inherit; }
/* The block: Kobalte puts it in the app's own top layer and positions it from the trigger, so there is no
   position rule here — only the box. */
.ocb-pop { width: max-content; min-width: 18em;
  max-width: min(22em, calc(100vw - 16px)); padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--v2-border-border-muted, rgba(255, 255, 255, .12));
  background: var(--v2-background-bg-layer-02, #1b1b1b);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35); color: var(--v2-text-text-base, inherit); font-size: 13px; }
/* The hover hint is wider than this panel, so it would show beside it: while any figure's panel is open, no
   tooltip is drawn anywhere. CSS cannot select only ours, and the panel is not modal, so the rest of the header
   stays hoverable — a trade, recorded in docs/oc-budget.md. */
body:has(.ocb-head[aria-expanded="true"]) [data-component="tooltip-v2"] { display: none; }
`

type Tone = "success" | "warning" | "danger"

const CLASS: Record<Tone, string> = { success: "ocb-ok", warning: "ocb-warn", danger: "ocb-bad" }
const cls = (tone: Tone | undefined) => (tone ? CLASS[tone] : "")

/** A stalled call must not leave the figure frozen: the guard resets only when the promise settles. */
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

/** Everything the figure and its block say, computed once. Reads the signals, so call it from JSX: the slot
 *  renders it reactively, and the popover reads the same signal while it is open. */
type Figures = {
	ready: boolean
	/** No wallet exists at all: an account with no provider connected, which is a state and not a fault.
	 *  Every surface says it instead of drawing a figure, and the header keeps its figure clickable. */
	empty: boolean
	error?: string
	label?: string
	walletTone?: Tone
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
	/** A wallet the snapshot does not carry has no connection: it is left out, not drawn empty. */
	ds?: Line
	or?: Line
	zen?: Line
}

const NO_LINES: Pick<Figures, "ds" | "or" | "zen"> = {}

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

			const refresh = (force = false) => {
				if (reading === server) return
				reading = server
				const input = force ? { force: true } : {}
				void withTimeout(session!.server.client.rpc(Budget).snapshot(input), RPC_TIMEOUT_MS)
					.then((value) => {
						// A slow answer from the server that was polled before must not overwrite this one.
						if (ctx.sessions.current()?.server.id !== server) return
						setSnapshot({ server, value: value as BudgetSnapshot })
						setFailure(undefined)
					})
					.catch((error: unknown) => {
						// Keep the last good reading: a failed poll says nothing about the balance, and
						// blanking the figure for five minutes cost a whole night (measured 2026-10-28, the
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

			refreshNow = () => refresh(true)
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
				return {
					ready: false,
					empty: false,
					error,
					wallet: "none",
					stale: false,
					age: 0,
					atPeak,
					marked: false,
					...NO_LINES,
				}
			}

			const value = current.value
			const wallet = payingWallet(model, value)
			const go = value.go
			const rolling = windowPercent(go?.rolling)
			const weekly = windowPercent(go?.weekly)
			const monthly = windowPercent(go?.monthly)
			const zen = value.zen?.available ?? value.zen?.balance
			const age = Date.now() - value.at

			// A wallet absent from the snapshot has no connection, so the figure says nothing — a dash
			// would still claim a reading. The popover leaves its line out for the same reason.
			const label =
				wallet === "go"
					? go
						? `GO · ${percent(monthly)}`
						: undefined
					: wallet === "zen"
						? value.zen
							? `ZEN · ${usd(zen)}`
							: undefined
						: wallet === "ds"
							? value.ds
								? `DS · ${usd(value.ds.balance)}`
								: undefined
							: wallet === "or"
								? value.or
									? `OR · ${usd(value.or.balance)}`
									: undefined
								: undefined

			// No figure at all is not "healthy": the colour is left out, as it is for a money wallet with
			// nothing to read.
			const goTone: Tone | undefined = [rolling, weekly, monthly].every((figure) => figure === null)
				? undefined
				: [rolling, weekly, monthly].some((figure) => figure !== null && figure >= 100)
					? "danger"
					: [rolling, weekly, monthly].some(
								(figure) => figure !== null && figure >= GO_WARN_PERCENT,
							)
						? "warning"
						: "success"
			const walletTone: Tone | undefined =
				wallet === "go"
					? goTone
					: wallet === "zen"
						? tone(zen ?? null, ZEN_WARN_USD, 0)
						: wallet === "ds"
							? tone(value.ds?.balance ?? null, DS_WARN_USD, 0)
							: tone(value.or?.balance ?? null, OR_WARN_USD, 0)

			return {
				ready: true,
				empty: !connected(value),
				error,
				label,
				walletTone,
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
				ds: value.ds && {
					figure: value.ds.balance,
					tone: tone(value.ds.balance ?? null, DS_WARN_USD, 0),
					note: value.ds.error,
				},
				or: value.or && {
					figure: value.or.balance,
					tone: tone(value.or.balance ?? null, OR_WARN_USD, 0),
					note: value.or.error,
				},
				zen: value.zen && { figure: zen, tone: tone(zen ?? null, ZEN_WARN_USD, 0), note: value.zen.error },
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
			// The tick is five minutes, so open on a fresh read: one call, and the figure follows it, because
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
								<Show when={f().empty}>
									<div class="ocb-dim ocb-empty">no provider connected</div>
									<div class="ocb-dim ocb-empty">opencode auth login</div>
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
													<span class="ocb-bad ocb-peak">{PEAK_MARK}</span>
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
								<Show when={f().ds}>
									{(line: () => Line) => (
										<WalletLine name="DS" line={line()} mark={f().atPeak ? PEAK_MARK : ""} />
									)}
								</Show>
								<Show when={f().or}>
									{(line: () => Line) => <WalletLine name="OR" line={line()} />}
								</Show>
								<Show when={f().zen}>
									{(line: () => Line) => <WalletLine name="ZEN" line={line()} />}
								</Show>
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

		/** Which figure draws, and what it says. */
		type Mark = "ring" | "card" | "error"

		/** The figure in the session header, beside the app's own context ring and cost. The mark carries the
		 *  colour: a ring where a percentage exists, a card where the wallet is money, the warning icon when
		 *  nothing could be read. The popover is the platform's — the top layer, the light dismiss and Escape
		 *  come with it. */
		const Tooltip = ctx.ui.Tooltip
		const HeaderBudget = (props: { input: SlotMap["session.header"] }) => {
			const figures = () => view(props.input)
			const [open, setOpen] = createSignal(false)

			/** The popover owns its dismissals — outside click, Escape — so this is the only place an open can
			 *  start, and it starts on a fresh read: the tick is five minutes. */
			const change = (next: boolean) => {
				if (next) refreshNow?.()
				setOpen(next)
			}

			/** The **provider**, not the model: the snapshot holds all four wallets already, so picking another
			 *  model of the same provider re-renders from what is here — a fifth model on DeepSeek changes which
			 *  line is drawn, not what is read. What the client cannot see is the credential behind a provider:
			 *  an account that expired, or a workspace switched. That shows up as the provider leaving the
			 *  catalog, or as the selected model falling to another one — measured 2026-11-01, a Go workspace
			 *  whose subscription ended mid-session. `createKeyed` is the SDK's, not a raw effect, so the re-run
			 *  follows the plugin's lifetime. */
			createKeyed(
				() => props.input.screen.composer.model()?.providerID ?? "none",
				() => {
					if (figures().age > PROVIDER_SWITCH_MS) refreshNow?.()
				},
			)

			/** Nothing read yet is not an error; a failure with nothing behind it is one, and hiding it is what
			 *  cost a whole night — `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*. Stale wins
			 *  over the figure: what is on screen is history, and the mark says so. */
			const shown = () => {
				const f = figures()
				if (f.ready && f.label) {
					const mark: Mark = f.wallet === "go" && f.go ? "ring" : "card"
					const tone = f.stale ? "warning" : f.walletTone
					return { f, text: f.label, tone: tone as Tone | undefined, mark }
				}
				if (f.error) {
					return { f, text: "budget", tone: "danger" as Tone, mark: "error" as Mark }
				}
				// No label means nothing to report for the model in front — either no wallet is connected,
				// or wallets are and none of them pays this one (a subscription that just ended, a provider
				// outside the four). The figure still exists either way: the plugin is installed and running,
				// so vanishing would say it is not. The mark is the wallet's own and the tone absent, so it
				// reads as switched off rather than as an alarm, and the popover carries the detail.
				if (f.ready && !f.label) {
					return { f, text: "budget", tone: undefined as Tone | undefined, mark: "card" as Mark }
				}
				return undefined
			}

			const seat = (f: Figures) =>
				f.error ??
				(f.empty
					? "Budget · no provider connected"
					: !f.label
						? "Budget · no wallet pays this model"
						: f.stale
							? `Budget · last read ${ageText(f.age)} ago`
							: "Budget — what pays, and every wallet")

			// `shown()` can go falsy and come back while the panel is open — the server switches and returns, a
			// snapshot loses the paying wallet's label — and the menu would remount already open, with no gesture
			// behind it. Closing with the menu that vanishes is the only state that cannot lie.
			createKeyed(
				() => (shown() ? true : undefined),
				() => {},
				{ otherwise: () => setOpen(false) },
			)

			return (
				<Show when={shown()}>
					{(s: () => NonNullable<ReturnType<typeof shown>>) => (
						<HeaderMenu
							label={s().f.stale ? `~${s().text}` : s().text}
							hint={seat(s().f)}
							tip={Tooltip}
							open={open()}
							onOpenChange={change}
							trigger={
								<>
									<span class={`ocb-mark ${cls(s().tone)}`}>
										<Show
											when={s().mark === "ring"}
											fallback={
												s().mark === "error" ? (
													<ctx.ui.Icon name="circle-exclamation" size="small" />
												) : (
													<WalletMark />
												)
											}
										>
											<Show when={s().f.go}>
												{(g: () => NonNullable<Figures["go"]>) => <Ring percent={g().monthly} />}
											</Show>
										</Show>
									</span>
									<Show when={!props.input.compact}>
										<span class="ocb-head-label">{s().f.stale ? `~${s().text}` : s().text}</span>
									</Show>
									<Show when={s().f.marked}>
										<span class="ocb-head-label ocb-bad" aria-hidden="true">
											{PEAK_MARK}
										</span>
									</Show>
								</>
							}
						>
							<Block input={props.input} />
						</HeaderMenu>
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
