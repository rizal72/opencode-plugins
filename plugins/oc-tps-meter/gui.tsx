// oc-tps-meter — GUI half: a side panel drawing tokens per second for every closed step of the session on
// screen, as a histogram, with the figures around it. The metric is `metrics.ts`.
import { Command, MenuItem, Panel, Plugin, Style, createKeyed, type MountedSession, type PanelTab } from "@opencode/plugin/gui"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"

import {
	BAR_PX,
	atRightEnd,
	followAfter,
	byModel,
	revertCut,
	STEP_PX,
	summarise,
	visibleRange,
	type Step,
	type StepMessage,
	type Summary,
} from "./metrics.ts"

const REFRESH_MS = 2_000
/** The panel's width, re-applied at every open. */
const PANEL_WIDTH = 360
/** The drawing's height in pixels, where a bar's top is measured from the baseline of a 0-based scale. */
const HEIGHT = 120
/** What a read asks for in one page, and the most it will accumulate before saying so. */
const PAGE = 200
const MAX_MESSAGES = 2_000

const CSS = `
/* Muted small capitals for labels, one large figure, hairlines between blocks, no borders and no cards. */
.tpsm { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-size: 12px;
  color: var(--v2-text-text-base); }
.tpsm-block { padding: 14px 12px; }
.tpsm-block + .tpsm-block { border-top: 1px solid color-mix(in srgb, var(--v2-text-text-base) 8%, transparent); }
.tpsm-label { color: var(--v2-text-text-faint); text-transform: uppercase; letter-spacing: .06em; font-size: 10px;
  font-weight: 600; margin-bottom: 6px; }
.tpsm-figure { font-size: 28px; line-height: 1.15; font-weight: 700; font-variant-numeric: tabular-nums; }
/* The unit is a label, not part of the figure: bold digits, a quiet "t/s" beside them. */
.tpsm-unit { font-size: 14px; font-weight: 400; opacity: .7; }
.tpsm-sub { color: var(--v2-text-text-faint); margin-top: 2px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
/* The chart pans sideways and nothing else: a step is a fixed 4 px, so a long session scrolls natively. */
.tpsm-chart { display: flex; overflow-x: auto; overflow-y: hidden; }
.tpsm-hist { display: block; flex: 0 0 auto; margin-left: auto; height: ${HEIGHT}px;
  color: var(--v2-text-text-base); }
.tpsm-axis { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: baseline; margin-top: 4px;
  color: var(--v2-text-text-faint); font-variant-numeric: tabular-nums; }
/* The way to the earlier steps, between the two dates: the only place it belongs, and silent when it all fits. */
.tpsm-pan { font-size: 10px; letter-spacing: .04em; opacity: .8; }
.tpsm-end { text-align: right; }
/* The rollover's detail: the tooltip, in the flow under the axis, its height reserved against the jumps. */
.tpsm-detail { min-height: 2.8em; margin-top: 2px; line-height: 1.4; font-variant-numeric: tabular-nums; }
/* The model is the point of the line, so it is not truncated; a name too long for the panel wraps. */
.tpsm-dmodel { overflow-wrap: anywhere; }
/* The speed is what the pointer is there for: bright and bold, the instant quiet beside it. */
.tpsm-dspeed { font-weight: 600; }
.tpsm-dmute { color: var(--v2-text-text-faint); }
.tpsm-dtime { color: var(--v2-text-text-faint); }
.tpsm-counts { margin-top: 6px; color: var(--v2-text-text-faint); line-height: 1.4; font-variant-numeric: tabular-nums; }
.tpsm-warn { margin-top: 4px; color: var(--v2-text-text-faint); line-height: 1.4; }
.tpsm-models { margin-top: 6px; }
/* One model per block, two lines read as one unit: the same rhythm as the detail above, and the space that
   tells two models apart on the pair's top only, never between a name and its numbers. */
.tpsm-mrow { line-height: 1.4; }
.tpsm-mrow + .tpsm-mrow { padding-top: 6px; }
.tpsm-mname { overflow-wrap: anywhere; }
.tpsm-mnum { color: var(--v2-text-text-faint); font-variant-numeric: tabular-nums; }
.tpsm-total { display: flex; justify-content: space-between; gap: 12px; line-height: 1.4; }
.tpsm-total > :first-child { color: var(--v2-text-text-faint); }
.tpsm-amount { font-variant-numeric: tabular-nums; }
.tpsm-note { padding: 12px; color: var(--v2-text-text-faint); }
`

type Reading = {
	readAt: number
	summary: Summary
	truncated: boolean
	/** A revert was staged and its message was older than what the read reached. */
	revertLost: boolean
}

type Failure = { at: number; error: string }

/** A speed that reads at a glance: whole numbers once they are three digits. */
const speed = (value: number) => (value >= 100 ? String(Math.round(value)) : value.toFixed(1))

const count = (value: number) => value.toLocaleString()

const clock = (at: number, withDay: boolean) =>
	withDay
		? new Date(at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
		: new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

const age = (ms: number) => (ms < 60_000 ? Math.round(ms / 1000) + "s" : Math.round(ms / 60_000) + "m")

/** `HH:MM:SS`, the granularity one step's instant needs. */
const stamp = (at: number) =>
	new Date(at).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })

/** Every message of the session, assistant and otherwise, handed back oldest first: the revert cut has to find
 *  the message it points at, which is usually a user one. */
const readAll = async (session: MountedSession): Promise<{ messages: StepMessage[]; truncated: boolean }> => {
	const messages: StepMessage[] = []
	let cursor: string | undefined
	for (;;) {
		// The order belongs to the first request only: a cursor carries its own direction.
		const page = await session.server.client.message.list({
			sessionID: session.id,
			limit: PAGE,
			...(cursor ? { cursor } : { order: "desc" as const }),
		})
		messages.push(...page.data)
		const next = page.cursor?.next ?? undefined
		if (!next) return { messages: messages.reverse(), truncated: false }
		if (messages.length >= MAX_MESSAGES) return { messages: messages.reverse(), truncated: true }
		cursor = next
	}
}

/** The revert point, when the session carries a staged revert. A failure is not a blank panel: it is thrown so
 *  the read keeps the figures it has, and the note says this is why. */
const revertOf = async (session: MountedSession): Promise<string | undefined> => {
	try {
		const info = await session.server.client.session.get({ sessionID: session.id })
		return info.revert?.messageID
	} catch (error) {
		throw new Error("the revert point could not be read (" + (error instanceof Error ? error.message : String(error)) + ")")
	}
}

const Total = (props: { label: string; value: string }) => (
	<div class="tpsm-total">
		<span>{props.label}</span>
		<span class="tpsm-amount">{props.value}</span>
	</div>
)

export default Plugin.define({
	setup(ctx) {
		const current = () => ctx.sessions.current()

		const View = () => {
			const [reading, setReading] = createSignal<Reading | undefined>(undefined)
			const [failure, setFailure] = createSignal<Failure | undefined>(undefined)
			const [loading, setLoading] = createSignal(false)
			/** The instant the note about age is read against, bumped by the poll so it never freezes. */
			const [now, setNow] = createSignal(Date.now())
			const [viewport, setViewport] = createSignal(0)
			const [scrolled, setScrolled] = createSignal(0)
			const [hovered, setHovered] = createSignal<number | undefined>(undefined)
			let box: HTMLDivElement | undefined
			/** True while the window sits at the right end. Written by the user's own scrolling only, so a read
			 *  that lands while they are reading back does not yank them forward. */
			let follow = true
			/** Where this plugin last scrolled to itself: its own event must not touch `follow`. */
			let ownScroll: number | undefined
			/** Until this instant every scroll event is the layout's doing — a clamp, a resize, our own settle —
			 *  never the user's word on where they want to be. */
			let programmaticUntil = 0

			// Keyed by `session.key`: another session means another read, and it starts blank so no figure of
			// the session before is ever drawn under this one's name. Each run owns its timer and its
			// `live` flag, so a late reply for the key it replaced is dropped twice over.
			createKeyed(
				() => current()?.key,
				(key: string) => {
					let live = true
					/** This key's reads, in the order they started: only the latest may write, errors included. */
					let sequence = 0
					setReading(undefined)
					setFailure(undefined)
					setLoading(true)
					// A new session inherits no offset: the right end, no hover, and following back on.
					setHovered(undefined)
					setScrolled(0)
					follow = true

					const read = async () => {
						const session = current()
						if (!session || session.key !== key) return
						const mine = (sequence += 1)
						const latest = () => live && mine === sequence && current()?.key === key
						try {
							const [page, revert] = await Promise.all([readAll(session), revertOf(session)])
							if (!latest()) return
							const cut = revertCut(page.messages, revert)
							// Assistant messages only are steps; the user and compaction ones existed for the cut.
							const kept = cut.messages.filter((message) => message.type === "assistant")
							// The content is about to change width: any scroll event until the layout settles is
							// the browser's, not the user's.
							programmaticUntil = performance.now() + 150
							setReading({
								readAt: Date.now(),
								summary: summarise(kept),
								truncated: page.truncated,
								revertLost: revert !== undefined && !cut.found && page.truncated,
							})
							setFailure(undefined)
							requestAnimationFrame(() => settle())
						} catch (error) {
							if (!latest()) return
							setFailure({ at: Date.now(), error: error instanceof Error ? error.message : String(error) })
						} finally {
							if (live && mine === sequence) setLoading(false)
						}
					}
					void read()
					// The app pushes no change event for message data, so the panel asks on a clock; the same tick
					// moves the instant the stale age is read against.
					const timer = setInterval(() => {
						setNow(Date.now())
						void read()
					}, REFRESH_MS)
					onCleanup(() => {
						live = false
						clearInterval(timer)
					})
				},
				{
					otherwise: () => {
						setReading(undefined)
						setFailure(undefined)
						setLoading(false)
						setHovered(undefined)
						setScrolled(0)
						follow = true
					},
				},
			)

			const value = () => reading()
			const summary = () => reading()?.summary
			/** A failed read after a good one: the figures stay, their age says they are old. */
			const stale = () => {
				const last = reading()
				const missed = failure()
				return last && missed && missed.at > last.readAt ? missed : undefined
			}

			const steps = () => summary()?.steps ?? []
			const lastStep = () => summary()?.last
			const peak = () => summary()?.peak
			const medianTps = () => summary()?.median
			// The drawing stops at the 95th percentile: the few steps above it are cut at the top edge, so one
			// freak step cannot flatten the other 95%. A short session's p95 is its peak, so nothing is cut.
			const scale = () => summary()?.scale ?? peak() ?? 1
			const y = (tps: number) => Math.max(0, HEIGHT - (tps / (scale() || 1)) * HEIGHT)
			const clipped = (tps: number) => tps > scale()

			// The chart is one bar per step in real pixels, so it can be wider than the panel and scrolls sideways.
			const contentWidth = () => steps().length * STEP_PX
			const chartWidth = () => Math.max(contentWidth(), viewport())
			const chartLeft = () => Math.max(0, chartWidth() - contentWidth())
			const range = () => visibleRange(steps().length, scrolled(), viewport())

			// The width is re-applied once at mount, never reactively, so a drag is not fought.
			onMount(() => {
				if (ctx.layout.side.width("tps") !== PANEL_WIDTH) ctx.layout.side.resize("tps", PANEL_WIDTH)
			})
			/** After a render: follow the newest only when the window was already at the right end, and clamp an
			 *  offset the content no longer has. */
			const settle = () => {
				const element = box
				if (!element) return
				programmaticUntil = performance.now() + 150
				const end = Math.max(0, element.scrollWidth - element.clientWidth)
				const target = follow ? end : Math.min(element.scrollLeft, end)
				if (target !== element.scrollLeft) {
					ownScroll = target
					element.scrollLeft = target
				}
				setScrolled(target)
			}
			const onScroll = () => {
				const element = box
				if (!element) return
				setScrolled(element.scrollLeft)
				// The bar the pointer was over is no longer where it pointed: the detail falls back to the last
				// bar in view, which is what the axis is describing.
				setHovered(undefined)
				// The scroll this plugin just made arrives as an event too, and it is not the user's word.
				if (ownScroll !== undefined && Math.abs(element.scrollLeft - ownScroll) <= 1) {
					ownScroll = undefined
					return
				}
				// Only a scroll the user made may move the latch: a clamp after the content shrank arrives as a
				// scroll event too, and it always lands at the right end (docs/oc-tps-meter.md, Traps).
				const user = performance.now() > programmaticUntil
				follow = followAfter(follow, {
					user,
					scrollLeft: element.scrollLeft,
					scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth,
				})
			}
			/** The chart's own wrapper, which the observer has to follow: it comes and goes with the steps. */
			let observer: ResizeObserver | undefined
			const watch = (element: HTMLDivElement) => {
				box = element
				observer?.disconnect()
				observer = new ResizeObserver(() => {
					setViewport(element.clientWidth)
					requestAnimationFrame(settle)
				})
				observer.observe(element)
				setViewport(element.clientWidth)
				requestAnimationFrame(settle)
			}
			onCleanup(() => observer?.disconnect())
			/** A step's slot is hoverable whether or not it was measured: the detail says which it was. */
			const point = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
				const list = steps()
				if (!list.length) return
				const left = event.currentTarget.getBoundingClientRect().left
				const index = Math.floor((event.clientX - left - chartLeft()) / STEP_PX)
				setHovered(Math.max(0, Math.min(list.length - 1, index)))
			}
			/** The step the detail describes: the one under the pointer, else the last one in the visible window. */
			const shown = (): Step | undefined => {
				const list = steps()
				const over = hovered()
				const index = over !== undefined && over < list.length ? over : range().last
				return index >= 0 ? list[index] : undefined
			}
			/** Row 1: the model of that step. */
			const detailModel = () => shown()?.model ?? "—"
			/** Row 2: the speed of the step under the pointer, or that it was not measured. One bar is one step, so
			 *  a count and a median would say nothing here. */
			const detailSpeed = () => {
				const step = shown()
				if (!step) return ""
				return step.tps === undefined ? "not measured" : speed(step.tps) + " t/s"
			}
			const detailTime = () => {
				const step = shown()
				return step === undefined ? "" : stamp(step.created)
			}
			const models = () => byModel(steps())
			const medianLine = () => {
				const value = medianTps()
				return value === undefined ? undefined : y(value)
			}
			const peakLine = () => {
				const value = peak()
				// Above the scale there is nowhere to draw it: the cut bars carry it, and the counts line says
				// the figure.
				return value === undefined || value > scale() ? undefined : y(value)
			}

			const figure = () => {
				const step = lastStep()
				return step?.tps === undefined ? "—" : speed(step.tps)
			}
			const model = () => lastStep()?.model ?? ""
			const ttft = () => {
				const value = lastStep()?.ttft
				// Milliseconds below a second, where the digits mean something; seconds above, where they do not.
				if (value === undefined) return ""
				return "TTFT " + (value < 1000 ? Math.round(value) + " ms" : (value / 1000).toFixed(1) + " s")
			}
			/** Absolute local times at the two ends of the visible window, with the day only when it spans more
			 *  than one. */
			const axis = () => {
				const list = steps()
				const { first, last } = range()
				const start = list[first]?.created
				const end = list[last]?.created
				if (start === undefined || end === undefined) return ["", ""]
				const withDay = new Date(start).toDateString() !== new Date(end).toDateString()
				return [clock(start, withDay), clock(end, withDay)]
			}
			/** Which way there is more to see, between the two dates: nothing when the whole session fits. */
			const pan = () => {
				if (contentWidth() <= viewport()) return ""
				const right = atRightEnd(scrolled(), contentWidth(), viewport())
				if (scrolled() <= 1) return "scroll →"
				return right ? "← scroll" : "← scroll →"
			}
			const counts = () => {
				const value = summary()
				if (!value) return ""
				const parts = [
					value.steps.length + " steps",
					value.measured + " measured",
					"median " + (value.median === undefined ? "—" : speed(value.median)) + " t/s",
					"peak " + (value.peak === undefined ? "—" : speed(value.peak)) + " t/s",
				]
				if (reading()?.truncated) parts.push("truncated")
				return parts.join(" · ")
			}
			const amount = (pick: (totals: Summary["totals"]) => number) => {
				const totals = summary()?.totals
				return totals ? count(pick(totals)) : ""
			}
			const hit = () => {
				const value = summary()?.totals.cacheHit
				return value === undefined ? "—" : Math.round(value * 100) + "%"
			}

			return (
				<div class="tpsm">
					<Show when={stale()}>
						{(missed: () => Failure) => (
							<div class="tpsm-block">
								<div class="tpsm-label">stale</div>
								<div class="tpsm-sub">
									read {age(now() - (value()?.readAt ?? now()))} ago, the last attempt failed:{" "}
									{missed().error}
								</div>
							</div>
						)}
					</Show>
					<Show when={value()} fallback={
						<Show
							when={failure()}
							fallback={
								<div class="tpsm-note">
									{loading() ? "reading this session's messages…" : "No session is routed."}
								</div>
							}
						>
							{(missed: () => Failure) => (
								<div class="tpsm-note">The messages could not be read: {missed().error}</div>
							)}
						</Show>
					}>
						<Show when={steps().length > 0} fallback={<div class="tpsm-note">No assistant step yet.</div>}>
							<div class="tpsm-block">
								<div class="tpsm-label">last measurable step</div>
								<div class="tpsm-figure">{figure()}<span class="tpsm-unit"> t/s</span></div>
								<div class="tpsm-sub">{[model(), ttft()].filter(Boolean).join(" · ")}</div>
							</div>
							<div class="tpsm-block">
								<div class="tpsm-chart" ref={watch} onScroll={onScroll}>
									<svg
										class="tpsm-hist"
										width={chartWidth()}
										height={HEIGHT}
										role="img"
										aria-label={counts()}
										onPointerMove={point}
										onPointerLeave={() => setHovered(undefined)}
									>
										{/* One drawing for every step, in real pixels: an unmeasured step leaves its slot empty, and the
										    two dashed lines are strokes at one pixel over the whole width. */}
										<For each={steps()}>
											{(step: Step, index) => {
												const tps = step.tps
												if (tps === undefined) return null
												return (
													<>
														<rect
															x={chartLeft() + index() * STEP_PX}
															y={y(tps)}
															width={BAR_PX}
															height={HEIGHT - y(tps)}
															fill="currentColor"
															opacity={index() === hovered() ? 1 : index() === steps().length - 1 ? 0.9 : 0.45}
														/>
														{/* Cut at the top: a bright cap says the bar goes on, and the detail line
														    still carries its real figure. */}
														<Show when={clipped(tps)}>
															<rect
																x={chartLeft() + index() * STEP_PX}
																y={0}
																width={BAR_PX}
																height={2}
																fill="currentColor"
																opacity={1}
															/>
														</Show>
													</>
												)
											}}
										</For>
										<Show when={medianLine() !== undefined}>
											<line
												x1="0"
												x2={chartWidth()}
												y1={medianLine()}
												y2={medianLine()}
												stroke="currentColor"
												stroke-width="1"
												stroke-dasharray="3 3"
												opacity="0.3"
											/>
										</Show>
										<Show when={peakLine() !== undefined}>
											<line
												x1="0"
												x2={chartWidth()}
												y1={peakLine()}
												y2={peakLine()}
												stroke="currentColor"
												stroke-width="1"
												stroke-dasharray="3 3"
												opacity="0.3"
											/>
										</Show>
									</svg>
								</div>
								<div class="tpsm-axis">
									<span>{axis()[0]}</span>
									<span class="tpsm-pan">{pan()}</span>
									<span class="tpsm-end">{axis()[1]}</span>
								</div>
								<div class="tpsm-detail">
									<div class="tpsm-dmodel">{detailModel()}</div>
									<div>
										<span class={shown()?.tps === undefined ? "tpsm-dmute" : "tpsm-dspeed"}>
											{detailSpeed()}
										</span>
										<span class="tpsm-dtime"> · {detailTime()}</span>
									</div>
								</div>
								<div class="tpsm-counts">{counts()}</div>
								<Show when={reading()?.revertLost}>
									<div class="tpsm-warn">
										the revert point is older than the messages read: undone steps may be counted
									</div>
								</Show>
								<div class="tpsm-models">
									<div class="tpsm-label">by model</div>
									<For each={models()}>
										{(row) => (
											<div class="tpsm-mrow">
												<div class="tpsm-mname">{row.model || "—"}</div>
												<div class="tpsm-mnum">
													{(row.steps === 1 ? "1 step" : row.steps + " steps") +
														" · med " +
														(row.median === undefined ? "—" : speed(row.median) + " t/s") +
														" · peak " +
														(row.peak === undefined ? "—" : speed(row.peak) + " t/s")}
												</div>
											</div>
										)}
									</For>
								</div>
							</div>
							<div class="tpsm-block">
								<div class="tpsm-label">totals</div>
								<Total label="input" value={amount((totals) => totals.input)} />
								<Total label="output" value={amount((totals) => totals.output)} />
								<Total label="reasoning" value={amount((totals) => totals.reasoning)} />
								<Total label="cache read" value={amount((totals) => totals.cacheRead)} />
								<Total label="cache write" value={amount((totals) => totals.cacheWrite)} />
								<Total label="cache hit" value={hit()} />
							</div>
						</Show>
					</Show>
				</div>
			)
		}

		const tab: PanelTab = {
			id: "tps",
			get title() {
				return "TPS"
			},
			closable: "hover",
		}

		ctx.add(Style, CSS)
		ctx.add(Panel, {
			id: "tps",
			region: "side",
			// The declared width puts the panel on the app's per-panel width store, which is what a drag writes.
			width: PANEL_WIDTH,
			list: (input) => (input.open.includes("tps") ? [tab] : []),
			render: () => <View />,
		})

		const toggle = () => {
			const session = current()
			if (!session) return
			ctx.layout.toggle(`${ctx.id}:tps`, session)
		}

		ctx.add(Command, (): Command => ({
			id: "open",
			title: "TPS Meter",
			description: "Decode speed of every closed step in this session",
			keywords: "tps speed tokens decode throughput latency ttft",
			section: "session",
			slash: { name: "tps" },
			enabled: !!current(),
			run: toggle,
		}))

		ctx.add(MenuItem, (): MenuItem => {
			const session = current()
			return {
				menu: "session.panel",
				id: "tps",
				title: "TPS Meter",
				icon: "window-analytics",
				keybind: `${ctx.id}.open`,
				opened: !!session && ctx.layout.state(`${ctx.id}:tps`, session) !== "closed",
				run: toggle,
			}
		})
	},
})
