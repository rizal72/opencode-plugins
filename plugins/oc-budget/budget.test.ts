// The one decision both halves read, tested where it lives: no UI, no credentials, no client to open.
//
// What it pins is the boundary a rendering test cannot reach — that an account with no wallet at all is
// told apart from a wallet that exists and failed, because one is a setup that has not happened and the
// other is a fault the user must see. `node --test`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { bindingWindow, connected, payingWallet, windowPercent } from "./budget.ts"

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

test("wallets exist and none of them pays this model: the state still has to be drawn", () => {
	// The case measured 2026-11-01: the subscription ended and the console answered without meters, so the
	// model in front stopped being one of the four. The wallet is still there — the figure must not vanish,
	// because a vanishing figure cannot be told from a plugin that is not installed.
	const snapshot = { at: 1, go: { error: "no Go plan on this workspace" }, ds: { balance: 5.33 } }
	assert.equal(connected(snapshot), true)
	assert.equal(payingWallet({ providerID: "anthropic", modelID: "claude" }), "none")
})

test("the binding window is the highest percent: the three are shares of three different limits", () => {
	// A 5h at 62% is a month at 12% — the 5h limit is a fifth of the monthly one — so the highest is the
	// first wall, never a comparable measure of what is left.
	assert.deepEqual(
		bindingWindow({ rolling: { percent: 62 }, weekly: { percent: 20 }, monthly: { percent: 7 } }),
		{ key: "rolling", percent: 62 },
	)
	assert.deepEqual(
		bindingWindow({ rolling: { percent: 9 }, weekly: { percent: 20 }, monthly: { percent: 94 } }),
		{ key: "monthly", percent: 94 },
	)
})

test("on a tie the longer window decides, because it blocks for longer", () => {
	assert.deepEqual(
		bindingWindow({
			rolling: { percent: 100 },
			weekly: { percent: 100 },
			monthly: { percent: 100 },
		}),
		{ key: "monthly", percent: 100 },
	)
	assert.deepEqual(
		bindingWindow({ rolling: { percent: 100 }, weekly: { percent: 100 }, monthly: { percent: 40 } }),
		{ key: "weekly", percent: 100 },
	)
})

test("a window with no reading is skipped, and no reading at all binds nothing", () => {
	assert.equal(bindingWindow(undefined), null)
	assert.equal(bindingWindow({}), null)
	assert.deepEqual(bindingWindow({ weekly: { percent: 12 }, monthly: {} }), { key: "weekly", percent: 12 })
})

test("a Go model stays on Go when a window is spent", () => {
	// Whether the requests then continue on the credits is the Console's Extra Usage toggle — off by
	// default on Go and Go Plus — which the snapshot cannot see. Naming the credits would describe the wrong
	// payer exactly when the reader needs the truth.
	assert.equal(payingWallet({ providerID: "opencode-go", modelID: "kimi-k3" }), "go")
})

test("a window the gateway stopped reads 100, whatever the endpoint rounded to", () => {
	// The console path already sets 100 when the limit is reached. The public fallback endpoint rounds down
	// and can name `rate-limited` at 99 or below, and a reading of 98 would paint a stopped window green and
	// let the report call it exhausted while the bar disagreed. The state is the reading.
	assert.equal(windowPercent({ status: "rate-limited", percent: 98 }), 100)
	assert.equal(windowPercent({ status: "ok", percent: 98 }), 98)
	assert.equal(windowPercent({ percent: 40 }), 40)
	assert.equal(windowPercent(undefined), null)
	assert.equal(windowPercent({}), null)
})
