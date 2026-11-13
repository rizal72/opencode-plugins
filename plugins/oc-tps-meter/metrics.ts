// oc-tps-meter — the metric, as pure functions over the messages the client returns. No imports: the test
// reads exactly what the panel reads. A step's speed is its own decode window, first token to last, and a
// step without a usable one is unmeasured, never zero.

export const MIN_TOKENS = 20
export const MIN_SPAN_MS = 200

export type MessageTime = {
	created?: number
	firstToken?: number
	streamed?: number
	completed?: number
}

export type MessageTokens = {
	input?: number
	output?: number
	reasoning?: number
	cache?: { read?: number; write?: number }
}

export type StepMessage = {
	id?: string
	/** `assistant`, `user`, `compaction`… Only the assistant ones are steps, but the revert cut needs them all. */
	type?: string
	time?: MessageTime
	tokens?: MessageTokens
	model?: { providerID?: string; id?: string; variant?: string }
	content?: readonly { type?: string; time?: null | { created?: number } }[]
}

export type Step = {
	id: string
	/** Epoch ms. */
	created: number
	tokens: number
	/** Only on a measured step. */
	tps?: number
	ttft?: number
	/** `providerID/modelID`, or empty when the message carried neither. */
	model: string
	measured: boolean
}

export type Totals = {
	input: number
	output: number
	reasoning: number
	cacheRead: number
	cacheWrite: number
	/** `cache.read / (input + cache.read + cache.write)`; undefined when all three are zero. */
	cacheHit?: number
}

export type Summary = {
	/** Oldest first, whether the messages arrived oldest or newest first. */
	steps: Step[]
	/** Sums over the same messages, measured or not. */
	totals: Totals
	measured: number
	/** The median of the measured speeds, not the mean. */
	median?: number
	peak?: number
	/** The top of the drawing: the 95th percentile, so one freak step cannot flatten the other 95%. */
	scale?: number
	/** The newest measured step. */
	last?: Step
}

const number = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** A finite instant, or nothing: a non-finite one cannot measure a window. */
const instant = (value: number | undefined) =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined

/** A step is closed only once `completed` is there: a message still streaming is not history. */
export const closed = (message: StepMessage) => message.time?.completed !== undefined

/** The instant generation started: the provider's own first token, and for the messages recorded before that
 *  field existed, the first **reasoning** part. Only reasoning: a tool part's time is when the call begins,
 *  after the model has already generated, and using it collapses the window — on real rows it turned 365 tokens
 *  into 1388 t/s. A text part carries no time at all, so an old text-only or tool-only message stays a gap. */
const started = (message: StepMessage): number | undefined => {
	const firstToken = instant(message.time?.firstToken)
	if (firstToken !== undefined) return firstToken
	let earliest: number | undefined
	for (const part of message.content ?? []) {
		if (part?.type !== "reasoning") continue
		const at = instant(part.time?.created)
		if (at !== undefined && (earliest === undefined || at < earliest)) earliest = at
	}
	return earliest
}

export const stepOf = (message: StepMessage): Step => {
	const tokens = number(message.tokens?.output) + number(message.tokens?.reasoning)
	const created = number(message.time?.created)
	const firstToken = started(message)
	const streamed = instant(message.time?.streamed)
	const span = firstToken !== undefined && streamed !== undefined ? streamed - firstToken : undefined
	const measured = span !== undefined && span >= MIN_SPAN_MS && tokens >= MIN_TOKENS
	const model =
		message.model?.providerID && message.model?.id ? message.model.providerID + "/" + message.model.id : ""
	return {
		id: message.id ?? "",
		created,
		tokens,
		tps: measured && span !== undefined ? tokens / (span / 1000) : undefined,
		ttft: firstToken !== undefined && created !== 0 ? firstToken - created : undefined,
		model,
		measured,
	}
}

/** The middle value, averaging the two middles on an even count. Undefined for no value at all. */
export const median = (values: readonly number[]): number | undefined => {
	if (values.length === 0) return undefined
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The value 95% of the speeds sit at or below, by nearest rank. */
export const p95 = (values: readonly number[]): number | undefined => {
	if (values.length === 0) return undefined
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

/** The top of the drawing: the peak itself, unless one step is more than twice the 95th percentile — then the
 *  scale stops at that fence, so a freak bar is cut instead of flattening every other one. With no such step
 *  this is exactly the peak. */
export const scaleOf = (values: readonly number[]): number | undefined => {
	if (values.length === 0) return undefined
	const max = Math.max(...values)
	return Math.min(max, 2 * (p95(values) ?? max))
}

/** A staged revert leaves the messages it undid stored but no longer part of the session: the message it points
 *  at and everything newer are dropped. The list is oldest first. `found` says whether that message was in it:
 *  an id from outside the window cuts nothing, and the caller has to say so. */
export type RevertCut = {
	messages: StepMessage[]
	found: boolean
}

export const revertCut = (messages: readonly StepMessage[], revertMessageID: string | undefined): RevertCut => {
	const stop = revertMessageID ? messages.findIndex((message) => message.id === revertMessageID) : -1
	return stop === -1 ? { messages: [...messages], found: false } : { messages: messages.slice(0, stop), found: true }
}

/** One row per model with at least one measured step, the busiest first and ties by name. The counts are of
 *  measured steps, which is what the row's speeds speak about. */
export type ModelStats = { model: string; steps: number; median?: number; peak?: number }

export const byModel = (steps: readonly Step[]): ModelStats[] => {
	const held = new Map<string, number[]>()
	for (const step of steps) {
		if (step.tps === undefined) continue
		const speeds = held.get(step.model) ?? []
		speeds.push(step.tps)
		held.set(step.model, speeds)
	}
	return [...held]
		.map(([model, speeds]) => ({ model, steps: speeds.length, median: median(speeds), peak: Math.max(...speeds) }))
		.sort((a, b) => b.steps - a.steps || a.model.localeCompare(b.model))
}

/** A bar is one step: 3 px of bar and the 1 px gap after it, so the chart is four pixels per step wide. */
export const BAR_PX = 3
export const STEP_PX = 4

/** The steps the window shows, as inclusive indices: the slot the left edge falls in and the one the right edge
 *  reaches. Nothing in view is `last < first`. */
export const visibleRange = (count: number, scrollLeft: number, viewport: number): { first: number; last: number } => {
	if (count <= 0) return { first: 0, last: -1 }
	const first = Math.max(0, Math.min(count - 1, Math.floor(scrollLeft / STEP_PX)))
	const last = Math.min(count - 1, Math.max(first, Math.ceil((scrollLeft + viewport) / STEP_PX) - 1))
	return { first, last }
}

/** Whether the window sits at its right end, within the native scroll's 1 px — and true when nothing overflows. */
export const atRightEnd = (scrollLeft: number, scrollWidth: number, clientWidth: number) =>
	scrollWidth - clientWidth - scrollLeft <= 1

/** Whether the window follows the newest step after a scroll event: only a scroll the user made can move that
 *  latch. A clamp after the content shrank, a resize and our own settle all arrive as scroll events too, and
 *  every one of them lands at the right end — reading them as intent would drag the user forward on the next
 *  read, which is exactly what the latch exists to prevent. */
export const followAfter = (
	current: boolean,
	event: { user: boolean; scrollLeft: number; scrollWidth: number; clientWidth: number },
): boolean =>
	event.user ? atRightEnd(event.scrollLeft, event.scrollWidth, event.clientWidth) : current

export const summarise = (messages: readonly StepMessage[]): Summary => {
	const history = messages.filter(closed)
	const steps = history.map(stepOf).sort((a, b) => a.created - b.created)
	const totals: Totals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
	for (const message of history) {
		totals.input += number(message.tokens?.input)
		totals.output += number(message.tokens?.output)
		totals.reasoning += number(message.tokens?.reasoning)
		totals.cacheRead += number(message.tokens?.cache?.read)
		totals.cacheWrite += number(message.tokens?.cache?.write)
	}
	const spent = totals.input + totals.cacheRead + totals.cacheWrite
	if (spent > 0) totals.cacheHit = totals.cacheRead / spent

	const speeds = steps.flatMap((step) => (step.tps === undefined ? [] : [step.tps]))
	const measured = steps.filter((step) => step.measured)
	return {
		steps,
		totals,
		measured: measured.length,
		median: median(speeds),
		peak: speeds.length ? Math.max(...speeds) : undefined,
		// A session with few steps gets its peak back: 95% of ten values is still nearly all of them.
		scale: scaleOf(speeds),
		last: measured[measured.length - 1],
	}
}
