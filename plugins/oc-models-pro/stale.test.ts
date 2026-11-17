// The fallback path a fixture in the other file cannot reach: the cache path is resolved when the
// module loads, so this process points XDG_CACHE_HOME at a copy from another day before importing it.
//
// What it pins is the difference the first version of this plugin lost: a kept copy is served, but the
// day it comes from travels with it, because a source that moved once must not stay invisible.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const cache = mkdtempSync(join(tmpdir(), "oc-models-pro-"))
mkdirSync(join(cache, "oc-models-pro"), { recursive: true })
const file = join(cache, "oc-models-pro", "go-limits.json")
writeFileSync(
	file,
	JSON.stringify({ fetched: "2000-01-01", plan: { price: 10, models: [{ id: "kept", limit: 100 }] } }),
)
process.env.XDG_CACHE_HOME = cache

const { goPlan } = await import("./multipliers.ts")

/** No network, and the failure kept out of the reporter's output. */
async function offline<T>(run: () => Promise<T>): Promise<T> {
	const original = globalThis.fetch
	const quiet = console.error
	globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch
	console.error = () => {}
	try {
		return await run()
	} finally {
		globalThis.fetch = original
		console.error = quiet
	}
}

test("a failed read serves the kept copy, and names the day it comes from", async () => {
	const snapshot = await offline(() => goPlan())
	assert.equal(snapshot?.stale, true)
	assert.equal(snapshot?.fetched, "2000-01-01")
	assert.deepEqual(snapshot?.plan.models, [{ id: "kept", limit: 100 }])
})

test("no copy and no read is no figures at all, not an empty column", async () => {
	rmSync(file)
	assert.equal(await offline(() => goPlan()), undefined)
})
