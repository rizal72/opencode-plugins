// The rules behind the credit column, pinned where no network is needed: what a tariff guard in the
// catalogue means, and which price on the docs page is the plan's.
//
// No model is named here: a fixture is a shape, not a fact about today's catalogue. The live source is
// probed by `node plugins/oc-models-pro/multipliers.ts --self-check`, before a release.
import assert from "node:assert/strict"
import { test } from "node:test"

import { credits, parseGoModels, parsePlanPrice } from "./multipliers.ts"

const payload = (models: unknown[]) => JSON.stringify({ data: models })
const paid = (extra: object = {}) => ({ go: { monthly_usage: { go: 100 } }, ...extra })
const hours = { any: [{ utc_hours: { gte: "01:00" } }, { utc_hours: { lt: "04:00" } }] }

test("a guard bound to hours is a peak tariff", () => {
	const list = parseGoModels(payload([{ id: "a", ...paid({ cost: { multipliers: [{ when: hours, factor: 2 }] } }) }]))
	assert.deepEqual(list, [{ id: "a", limit: 100, peak: 2 }])
})

test("a guard bound to a date is a price change scheduled upstream, not a peak", () => {
	const list = parseGoModels(
		payload([{ id: "a", ...paid({ cost: { multipliers: [{ when: { date: { gte: "2030-01-01" } }, factor: 2 }] } }) }]),
	)
	assert.deepEqual(list, [{ id: "a", limit: 100 }])
})

test("a guard carrying both a date and hours is still not a peak", () => {
	const list = parseGoModels(
		payload([
			{
				id: "a",
				...paid({ cost: { multipliers: [{ when: { date: { gte: "2030-01-01" }, ...hours }, factor: 2 }] } }),
			},
		]),
	)
	assert.deepEqual(list, [{ id: "a", limit: 100 }])
})

test("a step of 1x is no note at all", () => {
	const list = parseGoModels(payload([{ id: "a", ...paid({ cost: { multipliers: [{ when: hours, factor: 1 }] } }) }]))
	assert.deepEqual(list, [{ id: "a", limit: 100 }])
})

test("two hourly guards keep the largest step", () => {
	const list = parseGoModels(
		payload([{ id: "a", ...paid({ cost: { multipliers: [{ when: hours, factor: 2 }, { when: hours, factor: 3 }] } }) }]),
	)
	assert.deepEqual(list, [{ id: "a", limit: 100, peak: 3 }])
})

test("a free model carries no allowance and no row", () => {
	assert.deepEqual(parseGoModels(payload([{ id: "a", go: { monthly_usage: {} } }])), [])
	assert.deepEqual(parseGoModels(payload([{ id: "a" }])), [])
})

test("a useful allowance that is not a number rejects the whole payload, rather than one row", () => {
	// A missing allowance is a free model; a broken one is the source changing shape, and a plan with a
	// hole in it must not be written as today's.
	assert.throws(() => parseGoModels(payload([{ id: "a", go: { monthly_usage: { go: "100" } } }])), /not a positive number/)
	assert.throws(() => parseGoModels(payload([{ id: "a", go: { monthly_usage: { go: -1 } } }])), /not a positive number/)
	assert.throws(() => parseGoModels(payload([{ go: { monthly_usage: { go: 100 } } }])), /no id/)
	// A numeric id would key the map and never meet the string `modelID` of the row.
	assert.throws(() => parseGoModels(payload([{ id: 123, go: { monthly_usage: { go: 100 } } }])), /no id/)
	assert.throws(
		() => parseGoModels(payload([paid({ id: "a" }), paid({ id: "a" })])),
		/appears twice/,
	)
})

test("a broken payload parses to nothing", () => {
	assert.deepEqual(parseGoModels("not json"), [])
	assert.deepEqual(parseGoModels("{}"), [])
	assert.deepEqual(parseGoModels(JSON.stringify({ data: "nope" })), [])
	assert.deepEqual(parseGoModels(payload([{ id: "a", go: {} }])), [])
	assert.deepEqual(parseGoModels(payload([{ id: "a", go: { monthly_usage: { go: 0 } } }])), [])
})

test("the credit is the allowance over the plan price", () => {
	const table = credits({
		price: 10,
		models: [
			{ id: "a", limit: 100 },
			{ id: "b", limit: 15 },
			{ id: "c", limit: 20 },
		],
	})
	assert.equal(table.get("a")?.credit, 10)
	assert.equal(table.get("b")?.credit, 1.5)
	assert.equal(table.get("c")?.credit, 2)
})

test("the plan price is the standard plan's row, whatever the order", () => {
	assert.equal(
		parsePlanPrice(
			"<tr><td><strong>Go Plus</strong></td><td><strong>$40/month</strong></td></tr>" +
				"<tr><td><strong>Go</strong></td><td><strong>$10/month</strong></td></tr>",
		),
		10,
	)
	assert.equal(parsePlanPrice("<tr><td><strong>Go</strong></td><td><strong>$10/month</strong></td></tr>"), 10)
})

test("a page with no Go row has no price, and a stray figure is not it", () => {
	assert.equal(parsePlanPrice("<tr><td><strong>Go Plus</strong></td><td><strong>$40/month</strong></td></tr>"), undefined)
	assert.equal(parsePlanPrice("<p>from $99/month</p>"), undefined)
})
