// The reading a pill may serve: it is only true while the inventory still shows the version it was taken
// from. The case worth pinning is the one measured 2026-11-05 — `opencode plugin update` in the terminal
// leaves the six-hour cache alone, so the pill kept offering two plugins that were already there.
// `node --test`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { stillTrue } from "./index.ts"

const rows = [
	{ id: "github-panel", target: "opencode-github-panel", version: "0.2.1" },
	{ id: "lsp", target: "github:christensenjairus/opencode-v2-lsp-support", version: "4a17bc83" },
]

function inventory(github = "0.2.1", lsp = "4a17bc83") {
	return [
		{ id: "github-panel", source: { type: "package", target: "opencode-github-panel", version: github } },
		{ id: "lsp", source: { type: "package", target: "github:christensenjairus/opencode-v2-lsp-support", version: lsp } },
		{ id: "oc-git", source: { type: "local", path: "/somewhere" } },
		{ id: "opencode.tool.read", source: { type: "builtin" } },
	]
}

test("nothing moved: the reading stands", () => {
	assert.equal(stillTrue(rows, inventory()), true)
	assert.equal(stillTrue([], inventory()), true)
})

test("a plugin updated elsewhere makes the reading false, whichever one moved", () => {
	assert.equal(stillTrue(rows, inventory("0.2.2")), false)
	assert.equal(stillTrue(rows, inventory("0.2.1", "e055c985")), false)
})

test("a row for a plugin that is no longer installed is false too", () => {
	assert.equal(stillTrue(rows, inventory().filter((plugin) => plugin.id !== "github-panel")), false)
})

test("no inventory is not a changed inventory", () => {
	assert.equal(stillTrue(rows, undefined), true)
	assert.equal(stillTrue(rows, null), true)
	assert.equal(stillTrue(rows, { data: [] }), true)
})
