// The one decision both halves read, tested where it lives: no UI, no credentials, no client to open.
//
// What it pins is the boundary a rendering test cannot reach — that an account with no wallet at all is
// told apart from a wallet that exists and failed, because one is a setup that has not happened and the
// other is a fault the user must see. `node --test`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { connected } from "./budget.ts"

test("a snapshot with no wallet is an account with nothing connected", () => {
	assert.equal(connected(null), false)
	assert.equal(connected(undefined), false)
	assert.equal(connected({ at: 1 }), false)
})

test("a wallet that exists counts even when its read failed", () => {
	assert.equal(connected({ at: 1, zen: { error: "OpenCode Console not connected" } }), true)
	assert.equal(connected({ at: 1, or: { error: "HTTP 500" } }), true)
})

test("any one of the four is enough", () => {
	assert.equal(connected({ at: 1, go: { monthly: { percent: 12 } } }), true)
	assert.equal(connected({ at: 1, ds: { balance: 3 } }), true)
	assert.equal(connected({ at: 1, zen: { available: 0 } }), true)
})
