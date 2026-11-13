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
	/** The newest measured step. */
	last?: Step
}

const number = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** A finite instant, or nothing: a non-finite one cannot measure a window. */
const instant = (value: number | undefined) =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined

/** A step is closed only once `completed` is there: a message still streaming is not history. */
export const closed = (message: StepMessage) => message.time?.completed !== undefined

export const stepOf = (message: StepMessage): Step => {
	const tokens = number(message.tokens?.output) + number(message.tokens?.reasoning)
	const created = number(message.time?.created)
	const firstToken = instant(message.time?.firstToken)
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

/** One histogram column: the steps whose index falls in it, all of one model — a bar never mixes two, so the
 *  detail line can name the one that made it — the median of the measured ones, and the span it covers. */
export type Bucket = {
	/** Epoch ms of the first and the last step it covers. */
	from: number
	to: number
	steps: number
	/** Undefined when no step in it was measured: that is the gap. */
	median?: number
	/** The model of every step in it, or empty when the message carried neither. */
	model: string
}

/** One column out of a run of steps of a single model. */
const bucketOf = (slice: readonly Step[]): Bucket => {
	const speeds = slice.flatMap((step) => (step.tps === undefined ? [] : [step.tps]))
	return {
		from: slice[0].created,
		to: slice[slice.length - 1].created,
		steps: slice.length,
		median: median(speeds),
		model: slice[0].model,
	}
}

export const bucketise = (steps: readonly Step[], columns: number): Bucket[] => {
	if (steps.length === 0) return []
	const count = Math.max(1, Math.min(steps.length, Math.floor(columns)))
	const buckets: Bucket[] = []
	for (let index = 0; index < count; index += 1) {
		const slice = steps.slice(Math.floor((index * steps.length) / count), Math.floor(((index + 1) * steps.length) / count))
		// A target column that straddles a model switch is cut again at the switch: two short bars of two
		// models say more than one bar that has to explain both. It is never re-merged to reach the count.
		let run = 0
		for (let at = 1; at <= slice.length; at += 1) {
			if (at < slice.length && slice[at].model === slice[run].model) continue
			buckets.push(bucketOf(slice.slice(run, at)))
			run = at
		}
	}
	return buckets
}

/** The widest a bar is ever drawn, in pixels, and the share of its slot it fills: the rest is the gap that keeps
 *  two bars apart. */
export const BAR_MAX_PX = 6
export const BAR_GAIN = 0.7

/** Where the bars sit in the drawing's own units (0 to 100 across): a slot never gives its bar more than
 *  `BAR_MAX_PX`, and what it leaves over is empty chart to the left of them. */
export const barLayout = (count: number, widthPx: number): { left: number; slot: number } => {
	const bars = Math.max(1, count)
	const width = widthPx > 0 ? widthPx : 1
	const slotPx = Math.min(width / bars, BAR_MAX_PX / BAR_GAIN)
	return { left: ((width - bars * slotPx) / width) * 100, slot: (slotPx / width) * 100 }
}

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
		last: measured[measured.length - 1],
	}
}
