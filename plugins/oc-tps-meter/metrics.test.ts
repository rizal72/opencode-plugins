// The metric, tested where it lives: no client, no window, no session. `node --test`. What it pins is the
// difference the panel rests on: a measurable step against one that must be drawn as a gap.
import assert from "node:assert/strict"
import { test } from "node:test"

import {
	atRightEnd,
	BAR_PX,
	byModel,
	followAfter,
	MIN_SPAN_MS,
	MIN_TOKENS,
	p95,
	scaleOf,
	revertCut,
	STEP_PX,
	stepOf,
	summarise,
	visibleRange,
	type StepMessage,
} from "./metrics.ts"

const message = (over: Partial<StepMessage> = {}): StepMessage => ({
	id: "msg-1",
	time: { created: 1_000, firstToken: 1_400, streamed: 3_400, completed: 3_500 },
	tokens: { input: 100, output: 80, reasoning: 20, cache: { read: 0, write: 0 } },
	model: { providerID: "opencode-go", id: "deepseek-v4" },
	...over,
})

test("a normal step: output plus reasoning over first token to last", () => {
	const step = stepOf(message())
	assert.equal(step.tokens, 100)
	assert.equal(step.measured, true)
	assert.equal(step.tps, 50) // 100 tokens over the 2 s window
	assert.equal(step.ttft, 400)
	assert.equal(step.model, "opencode-go/deepseek-v4")
})

test("a text-only step still measures: `time: null` on the part says nothing about the stream", () => {
	// Its own message, so nothing here inherits the normal fixture's answer: 60 tokens over a one-second window.
	const textOnly: StepMessage = {
		id: "text-only",
		time: { created: 2_000, firstToken: 2_500, streamed: 3_500, completed: 3_600 },
		tokens: { input: 50, output: 45, reasoning: 15 },
	}
	const step = stepOf(textOnly)
	assert.equal(step.tokens, 60)
	assert.equal(step.measured, true)
	assert.equal(step.tps, 60) // 60 tokens over the 1 s window
	assert.equal(step.ttft, 500)
})

test("no firstToken: unmeasured, never zero, and no fallback to `completed`", () => {
	// `firstToken` absent, `completed` present and `streamed` absent: a denominator of either one would make
	// this measurable, so the case pins that only `streamed - firstToken` measures.
	const step = stepOf(message({ time: { created: 1_000, completed: 4_000 } }))
	assert.equal(step.measured, false)
	assert.equal(step.tps, undefined)
	assert.equal(step.ttft, undefined)
})

test("a message older than firstToken measures from its first timed part", () => {
	// Messages recorded before the host wrote `firstToken` carry only the parts' own times; without this the
	// whole history of a session started earlier shows as empty slots.
	const old = stepOf(
		message({
			time: { created: 1_000, streamed: 3_400, completed: 3_500 },
			content: [{ type: "reasoning", time: { created: 1_400 } }, { type: "text", time: null }],
		}),
	)
	assert.equal(old.measured, true)
	assert.equal(old.tps, 50)
	assert.equal(old.ttft, 400)
})

test("an old message whose only timed part is a tool call stays unmeasured", () => {
	// A tool part's time is when the call begins, after generation: using it collapses the window and reports
	// rates no provider reaches.
	const step = stepOf(
		message({
			time: { created: 1_000, streamed: 3_400, completed: 3_500 },
			content: [{ type: "tool", time: { created: 3_100 } }],
		}),
	)
	assert.equal(step.measured, false)
	assert.equal(step.tps, undefined)
})

test("an old message with no timed part stays unmeasured", () => {
	const step = stepOf(
		message({ time: { created: 1_000, streamed: 3_400, completed: 3_500 }, content: [{ type: "text", time: null }] }),
	)
	assert.equal(step.measured, false)
	assert.equal(step.tps, undefined)
})

test("firstToken outranks a part's timestamp", () => {
	const step = stepOf(
		message({ content: [{ type: "tool", time: { created: 3_100 } }] }),
	)
	assert.equal(step.tps, 50) // the 2 s window from firstToken, not the 300 ms one from the part
})

test("under 20 tokens is unmeasured however long the window", () => {
	const step = stepOf(message({ tokens: { output: 12, reasoning: 4 } }))
	assert.equal(step.tokens, 16)
	assert.ok(step.tokens < MIN_TOKENS)
	assert.equal(step.measured, false)
	assert.equal(step.tps, undefined)
})

test("a 100 ms window is unmeasured: the sample is shorter than the timer's resolution", () => {
	const step = stepOf(message({ time: { created: 1_000, firstToken: 1_400, streamed: 1_500, completed: 1_600 } }))
	assert.ok(100 < MIN_SPAN_MS)
	assert.equal(step.measured, false)
	assert.equal(step.tps, undefined)
	// The wait for the first token is still known, so it is still reported.
	assert.equal(step.ttft, 400)
})

test("a non-finite instant is a gap, never a speed of zero", () => {
	// `streamed: Infinity` would otherwise pass the span threshold and read as 0 t/s, which is a value.
	const infinite = stepOf(message({ time: { created: 1_000, firstToken: 1_400, streamed: Infinity, completed: 3_500 } }))
	assert.equal(infinite.measured, false)
	assert.equal(infinite.tps, undefined)
	assert.equal(infinite.ttft, 400)

	const notANumber = stepOf(
		message({ time: { created: 1_000, firstToken: Number.NaN, streamed: 3_400, completed: 3_500 } }),
	)
	assert.equal(notANumber.measured, false)
	assert.equal(notANumber.tps, undefined)
	assert.equal(notANumber.ttft, undefined)
})

test("cache hit is the read share of every input token", () => {
	const summary = summarise([
		message({ id: "a", tokens: { input: 100, output: 30, reasoning: 0, cache: { read: 300, write: 100 } } }),
		message({ id: "b", tokens: { input: 100, output: 30, reasoning: 0, cache: { read: 100, write: 0 } } }),
	])
	assert.equal(summary.totals.cacheRead, 400)
	assert.equal(summary.totals.cacheWrite, 100)
	assert.equal(summary.totals.input, 200)
	assert.equal(summary.totals.cacheHit, 400 / 700)
})

test("no tokens at all is no cache-hit figure, not a division by zero", () => {
	const summary = summarise([message({ tokens: {} })])
	assert.equal(summary.totals.cacheHit, undefined)
})

test("totals sum every closed message, and the steps read oldest first whatever order they arrived in", () => {
	const summary = summarise([
		message({ id: "newer", time: { created: 9_000, firstToken: 9_400, streamed: 11_400, completed: 11_500 } }),
		message({ id: "older", time: { created: 1_000, firstToken: 1_400, streamed: 3_400, completed: 3_500 } }),
	])
	assert.deepEqual(
		summary.steps.map((step) => step.id),
		["older", "newer"],
	)
	assert.equal(summary.totals.input, 200)
	assert.equal(summary.totals.output, 160)
	assert.equal(summary.totals.reasoning, 40)
	assert.equal(summary.steps.length, 2)
	assert.equal(summary.measured, 2)
})

test("the average is a median, and the peak is the maximum", () => {
	const one = (tokens: number) => message({ tokens: { output: tokens, reasoning: 0 } })
	// 10, 20 and 100 t/s over the same 2 s window: the mean is 43.3, the median 20.
	const summary = summarise([one(20), one(40), one(200)])
	assert.equal(summary.median, 20)
	assert.equal(summary.peak, 100)
	// An even count averages the two middles.
	const even = summarise([one(20), one(40), one(200), one(400)])
	assert.equal(even.median, (20 + 100) / 2)
})

test("an unmeasured step is still a step: it counts, it is drawn as a gap, and it has no speed", () => {
	const summary = summarise([
		message({ id: "a" }),
		message({ id: "b", time: { created: 5_000, completed: 5_100 } }),
	])
	assert.equal(summary.steps.length, 2)
	assert.equal(summary.measured, 1)
	assert.equal(summary.steps[1].tps, undefined)
	assert.equal(summary.last?.id, "a")
})

test("a step still streaming is not history: no bar, no last-step figure, no share of the totals", () => {
	// The open message has everything a measurement needs and only lacks `completed`.
	const open: StepMessage = {
		id: "open",
		time: { created: 9_000, firstToken: 9_400, streamed: 11_400 },
		tokens: { input: 900, output: 80, reasoning: 20, cache: { read: 5_000, write: 200 } },
	}
	const summary = summarise([message({ id: "closed" }), open])
	assert.deepEqual(
		summary.steps.map((step) => step.id),
		["closed"],
	)
	assert.equal(summary.measured, 1)
	assert.equal(summary.last?.id, "closed")
	// The totals are the closed message's alone: the open one's 900 input never lands.
	assert.equal(summary.totals.input, 100)
	assert.equal(summary.totals.cacheRead, 0)
})

test("no message is an empty summary, not a crash", () => {
	const summary = summarise([])
	assert.deepEqual(summary.steps, [])
	assert.equal(summary.measured, 0)
	assert.equal(summary.median, undefined)
	assert.equal(summary.peak, undefined)
	assert.equal(summary.last, undefined)
	assert.equal(summary.totals.cacheHit, undefined)
})

test("the visible window is the steps the scroll position and the viewport cover", () => {
	// Ten steps of 4 px: 40 px of content.
	assert.deepEqual(visibleRange(10, 0, 24), { first: 0, last: 5 })
	// Scrolled: 8 px in, a 16 px window reaches from step 2 to step 5.
	assert.deepEqual(visibleRange(10, 8, 16), { first: 2, last: 5 })
	// The right edge of the window lands mid-slot, and still counts the step it shows.
	assert.deepEqual(visibleRange(10, 8, 17), { first: 2, last: 6 })
	// Nothing outside the content, whatever the scroll says.
	assert.deepEqual(visibleRange(10, 10_000, 40), { first: 9, last: 9 })
	// A width the app has not measured yet shows the step the left edge is in.
	assert.deepEqual(visibleRange(10, 8, 0), { first: 2, last: 2 })
	// No step at all is nothing in view.
	assert.deepEqual(visibleRange(0, 0, 100), { first: 0, last: -1 })
	assert.equal(STEP_PX, BAR_PX + 1)
})

test("at the right end means within a pixel, and always when nothing overflows", () => {
	assert.equal(atRightEnd(0, 40, 100), true)
	assert.equal(atRightEnd(0, 100, 100), true)
	assert.equal(atRightEnd(59, 100, 40), true)
	assert.equal(atRightEnd(59.5, 100, 40), true)
	assert.equal(atRightEnd(58, 100, 40), false)
	assert.equal(atRightEnd(0, 100, 40), false)
})

test("per model: measured steps only, busiest first, ties by name", () => {
	const at = (id: string, created: number, tokens: number, model: StepMessage["model"]) =>
		message({
			id,
			model,
			time: { created, firstToken: created + 400, streamed: created + 2_400, completed: created + 2_500 },
			tokens: { output: tokens, reasoning: 0 },
		})
	const fast = { providerID: "opencode-go", id: "deepseek-v4" }
	const slow = { providerID: "anthropic", id: "opus" }
	const unmeasured = { providerID: "local", id: "tiny" }
	const steps = summarise([
		at("a", 1_000, 20, fast),
		at("b", 1_500, 40, fast),
		at("c", 2_000, 60, fast),
		at("d", 3_000, 200, slow),
		at("e", 4_000, 100, slow),
		message({ id: "f", model: unmeasured, time: { created: 5_000, completed: 5_100 }, tokens: { output: 4 } }),
	]).steps
	const rows = byModel(steps)
	// The unmeasured model has no row at all: the block speaks about speeds.
	assert.deepEqual(
		rows.map((row) => row.model),
		["opencode-go/deepseek-v4", "anthropic/opus"],
	)
	assert.equal(rows[0].steps, 3)
	assert.equal(rows[0].median, 20) // 10, 20 and 30 t/s
	assert.equal(rows[0].peak, 30)
	assert.equal(rows[1].median, 75) // 100 and 50 t/s
	// A tie on the count is broken by name.
	const tie = byModel(summarise([at("g", 1_000, 200, slow), at("h", 2_000, 20, fast)]).steps)
	assert.deepEqual(
		tie.map((row) => row.model),
		["anthropic/opus", "opencode-go/deepseek-v4"],
	)
	assert.equal(byModel([]).length, 0)
})

test("a staged revert cuts the message it points at and everything newer, and says whether it found it", () => {
	const list: StepMessage[] = [
		{ id: "u1", type: "user", time: { created: 1_000 } },
		{ id: "a1", type: "assistant", time: { created: 2_000, completed: 2_100 } },
		{ id: "u2", type: "user", time: { created: 3_000 } },
		{ id: "a2", type: "assistant", time: { created: 4_000, completed: 4_100 } },
	]
	// The revert points at the user message: it and the answer after it are gone.
	const cut = revertCut(list, "u2")
	assert.deepEqual(
		cut.messages.map((message) => message.id),
		["u1", "a1"],
	)
	assert.equal(cut.found, true)
	// A revert on the oldest message leaves nothing, which is the honest answer.
	assert.deepEqual(revertCut(list, "u1"), { messages: [], found: true })
	// No revert, and an id from outside the window, both leave the session as it is and report no boundary.
	assert.deepEqual(revertCut(list, undefined), { messages: [...list], found: false })
	const gone = revertCut(list, "gone")
	assert.equal(gone.messages.length, 4)
	assert.equal(gone.found, false)
	// The list is not mutated: the panel reads it again on the next poll.
	assert.equal(list.length, 4)
})

test("p95 is the nearest rank, so one freak step does not set the top of the drawing", () => {
	assert.equal(p95([]), undefined)
	// Twenty values: the 95th percentile by nearest rank is the 19th, not the highest.
	const even = Array.from({ length: 20 }, (_, index) => index + 1)
	assert.equal(p95(even), 19)
	// One step ten times faster than the rest does not move it.
	const freak = [...Array.from({ length: 19 }, () => 100), 1_000]
	assert.equal(p95(freak), 100)
})

test("the scale is the peak, unless one step is more than twice the 95th percentile", () => {
	// No freak: the top of the drawing is the peak itself, so every bar keeps its true height.
	const even = Array.from({ length: 20 }, (_, index) => index + 1)
	assert.equal(scaleOf(even), 20)
	// One step three times the rest: the scale stops at twice the p95, and only that bar is cut.
	const freak = [...Array.from({ length: 19 }, () => 100), 600]
	assert.equal(scaleOf(freak), 200)
})

test("only the user's own scroll moves the follow latch", () => {
	const at = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 1_000, clientWidth: 400 })
	// The user scrolls back: following stops.
	assert.equal(followAfter(true, { user: true, ...at(100) }), false)
	// The user scrolls to the right end again: it resumes.
	assert.equal(followAfter(false, { user: true, ...at(600) }), true)
	// A clamp after the content shrank lands at the right end, and must not be read as intent.
	assert.equal(followAfter(false, { user: false, ...at(600) }), false)
	// A resize that lands at the right end is the same.
	assert.equal(followAfter(false, { user: false, ...at(0) }), false)
})
