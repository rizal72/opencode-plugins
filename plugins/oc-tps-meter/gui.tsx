// oc-tps-meter — GUI half: a side panel drawing tokens per second for every closed step of the session on
// screen, as a histogram, with the figures around it. The metric is `metrics.ts`.
import { Command, MenuItem, Panel, Plugin, Style, createKeyed, type MountedSession, type PanelTab } from "@opencode/plugin/gui"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"

import {
	BAR_GAIN,
	byModel,
	revertCut,
	bucketise,
	barLayout,
	summarise,
	type Bucket,
	type StepMessage,
	type Summary,
} from "./metrics.ts"

const REFRESH_MS = 2_000
/** The panel's width, re-applied at every open. */
const PANEL_WIDTH = 360
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
.tpsm-figure { font-size: 28px; line-height: 1.15; font-weight: 500; font-variant-numeric: tabular-nums; }
.tpsm-sub { color: var(--v2-text-text-faint); margin-top: 2px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
/* One drawing for the whole histogram: it stretches with the panel, the strokes do not, and the bars keep
   their pixel width — barLayout in metrics.ts decides where they land. */
.tpsm-hist { display: block; width: 100%; height: 120px; color: var(--v2-text-text-base); }
.tpsm-axis { display: flex; justify-content: space-between; margin-top: 4px; color: var(--v2-text-text-faint);
  font-variant-numeric: tabular-nums; }
/* The rollover's detail: the tooltip, in the flow under the axis, its height reserved against the jumps. */
.tpsm-detail { min-height: 2.8em; margin-top: 2px; line-height: 1.4; font-variant-numeric: tabular-nums; }
/* The model is the point of the line, so it is not truncated; a name too long for the panel wraps. */
.tpsm-dmodel { overflow-wrap: anywhere; }
.tpsm-dmeta { color: var(--v2-text-text-faint); opacity: .9; }
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

/** `HH:MM:SS`, the granularity a bucket of steps needs. */
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
							setReading({
								readAt: Date.now(),
								summary: summarise(kept),
								truncated: page.truncated,
								revertLost: revert !== undefined && !cut.found && page.truncated,
							})
							setFailure(undefined)
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
			const top = () => Math.max(peak() ?? 0, 1)
			const y = (tps: number) => 100 - (tps / top()) * 100

			// A step is a fraction of a pixel wide, so bars are bucketed, each reading as the median of its steps;
			// an unmeasured bucket is the gap. This decides the drawing only, never the counts.
			const [drawWidth, setDrawWidth] = createSignal(296)
			const [hovered, setHovered] = createSignal<number | undefined>(undefined)
			let chart: SVGSVGElement | undefined
			// The width is re-applied once at mount, never reactively, so a drag is not fought.
			onMount(() => {
				if (ctx.layout.side.width("tps") !== PANEL_WIDTH) ctx.layout.side.resize("tps", PANEL_WIDTH)
			})
			onMount(() => {
				const element = chart
				if (!element) return
				const observer = new ResizeObserver(() => setDrawWidth(element.getBoundingClientRect().width))
				observer.observe(element)
				onCleanup(() => observer.disconnect())
			})
			const buckets = () => bucketise(steps(), drawWidth() / 2)
			// The bars sit against the right edge, where the newest one is, and the chart to their left is empty.
			const bars = () => barLayout(buckets().length, drawWidth())
			const barX = (index: number) => bars().left + index * bars().slot + bars().slot * 0.15
			const barWidth = () => bars().slot * BAR_GAIN
			const newestBar = () => {
				const list = buckets()
				for (let index = list.length - 1; index >= 0; index -= 1) if (list[index].median !== undefined) return index
				return -1
			}
			/** The bucket the pointer is over, which the detail line describes; the newest one when it is away. */
			const shown = (): Bucket | undefined => buckets()[hovered() ?? newestBar()]
			const point = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
				const list = buckets()
				const width = event.currentTarget.getBoundingClientRect()
				if (!list.length || !width.width) return
				// In the drawing's own units, so the empty chart to the left of the bars lands on the first one.
				const { left, slot } = bars()
				const index = Math.floor((((event.clientX - width.left) / width.width) * 100 - left) / slot)
				setHovered(Math.max(0, Math.min(list.length - 1, index)))
			}
			/** Row 1: the one model the bucket holds. */
			const detailModel = () => shown()?.model ?? "—"
			/** Row 2: the steps, the speed and the instant — a single one unless the bucket really spans more
			 *  than a second. */
			const detail = () => {
				const bucket = shown()
				if (!bucket) return ""
				const parts: string[] = [bucket.steps === 1 ? "1 step" : bucket.steps + " steps"]
				const tps = (bucket.median === undefined ? "—" : speed(bucket.median)) + " t/s"
				parts.push(bucket.steps > 1 ? "median " + tps : tps)
				const from = stamp(bucket.from)
				const to = stamp(bucket.to)
				parts.push(from === to ? from : from + "–" + to)
				return parts.join(" · ")
			}
			const models = () => byModel(steps())
			const medianLine = () => {
				const value = medianTps()
				return value === undefined ? undefined : y(value)
			}
			const peakLine = () => {
				const value = peak()
				return value === undefined ? undefined : y(value)
			}

			const figure = () => {
				const step = lastStep()
				return step?.tps === undefined ? "—" : speed(step.tps) + " t/s"
			}
			const model = () => lastStep()?.model ?? ""
			const ttft = () => {
				const value = lastStep()?.ttft
				// Milliseconds below a second, where the digits mean something; seconds above, where they do not.
				if (value === undefined) return ""
				return "TTFT " + (value < 1000 ? Math.round(value) + " ms" : (value / 1000).toFixed(1) + " s")
			}
			/** Absolute local times at the two ends, with the day only when the session spans more than one. */
			const axis = () => {
				const list = steps()
				const first = list[0]?.created
				const end = list[list.length - 1]?.created
				if (first === undefined || end === undefined) return ["", ""]
				const withDay = new Date(first).toDateString() !== new Date(end).toDateString()
				return [clock(first, withDay), clock(end, withDay)]
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
								<div class="tpsm-figure">{figure()}</div>
								<div class="tpsm-sub">{[model(), ttft()].filter(Boolean).join(" · ")}</div>
							</div>
							<div class="tpsm-block">
								<svg
									class="tpsm-hist"
									ref={(element: SVGSVGElement) => (chart = element)}
									viewBox="0 0 100 100"
									preserveAspectRatio="none"
									role="img"
									aria-label={counts()}
									onPointerMove={point}
									onPointerLeave={() => setHovered(undefined)}
								>
									{/* One drawing for every step: bars are fills, the dashed lines are strokes kept at one pixel by
									    `vector-effect`, and a bucket with no measured step draws nothing. */}
									<For each={buckets()}>
										{(bucket: Bucket, index) => {
											const tps = bucket.median
											if (tps === undefined) return null
											return (
												<rect
													x={barX(index())}
													y={y(tps)}
													width={barWidth()}
													height={100 - y(tps)}
													fill="currentColor"
													opacity={index() === hovered() ? 1 : index() === newestBar() ? 0.9 : 0.45}
												/>
											)
										}}
									</For>
									<Show when={medianLine() !== undefined}>
										<line
											x1="0"
											x2="100"
											y1={medianLine()}
											y2={medianLine()}
											stroke="currentColor"
											stroke-width="1"
											stroke-dasharray="3 3"
											opacity="0.3"
											vector-effect="non-scaling-stroke"
										/>
									</Show>
									<Show when={peakLine() !== undefined}>
										<line
											x1="0"
											x2="100"
											y1={peakLine()}
											y2={peakLine()}
											stroke="currentColor"
											stroke-width="1"
											stroke-dasharray="3 3"
											opacity="0.3"
											vector-effect="non-scaling-stroke"
										/>
									</Show>
								</svg>
								<div class="tpsm-axis">
									<span>{axis()[0]}</span>
									<span>{axis()[1]}</span>
								</div>
								<div class="tpsm-detail">
									<div class="tpsm-dmodel">{detailModel()}</div>
									<div class="tpsm-dmeta">{detail()}</div>
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
