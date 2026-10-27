// oc-models-pro/aa.ts — tokens per second for the models this machine has never run, from
// Artificial Analysis' free API. Attribution: https://artificialanalysis.ai/
//
// Their number is the same measurement as ours — "the average number of tokens received per second,
// after the first token is received" — so filling an empty cell with it does not mix two families,
// the way `int` and speed already do. The panel marks those values with a leading `~`, because they
// were measured on their infrastructure and not on this person's provider.
//
// No key, no calls: without ARTIFICIAL_ANALYSIS_API_KEY this module returns an empty map and nothing
// leaves the machine. With a key the response is cached six hours, which their terms ask for.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/aa.ts --self-check

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { benchKey } from "./bench.ts"

export const AA = "https://artificialanalysis.ai/api/v2/data/llms/models"

const CACHE_DIR = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
const CACHE = join(CACHE_DIR, "oc-models-pro", "aa.json")
const GRACE_MS = 6 * 60 * 60 * 1000
/** Optional decoration must never hold the panel: a hanging endpoint gives up after this. */
const FETCH_MS = 5_000

interface Cached {
	fetched: number
	index: Record<string, number>
}

export function apiKey(): string | undefined {
	const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY
	return key && key.trim() ? key.trim() : undefined
}

/** Name first, slug second — the same meeting point `bench.ts` uses, so one model has one key. */
export function buildIndex(payload: any): Map<string, number> {
	const index = new Map<string, number>()
	for (const entry of payload?.data ?? []) {
		const tps = entry?.median_output_tokens_per_second
		if (typeof tps !== "number" || !(tps > 0)) continue
		for (const candidate of [entry.name, entry.slug]) {
			if (typeof candidate !== "string") continue
			const key = benchKey(candidate)
			// A key met twice keeps the faster figure: label stripping can fuse a variant into its base
			// model, and the slower of the two would understate what the faster one shows.
			if (key) index.set(key, Math.max(index.get(key) ?? 0, tps))
		}
	}
	return index
}

/** A cache is a file on disk: a value that is not a positive number is not a measurement. */
function fromCache(previous: Cached): Map<string, number> {
	const index = new Map<string, number>()
	for (const [key, value] of Object.entries(previous.index ?? {})) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) index.set(key, value)
	}
	return index
}

async function cached(): Promise<Cached | undefined> {
	try {
		return JSON.parse(await readFile(CACHE, "utf8")) as Cached
	} catch {
		return undefined
	}
}

/** Empty without a key: this is the whole cost of the column being optional. */
export async function aaIndex(): Promise<Map<string, number>> {
	const key = apiKey()
	if (!key) return new Map()
	const previous = await cached()
	if (previous && Date.now() - previous.fetched < GRACE_MS) return fromCache(previous)
	try {
		const response = await fetch(AA, {
			headers: { "x-api-key": key, "user-agent": "oc-models-pro" },
			signal: AbortSignal.timeout(FETCH_MS),
		})
		if (!response.ok) throw new Error("HTTP " + response.status)
		const built = buildIndex(await response.json())
		if (built.size === 0) throw new Error("response shape changed")
		await mkdir(dirname(CACHE), { recursive: true })
		await writeFile(CACHE + ".tmp", JSON.stringify({ fetched: Date.now(), index: Object.fromEntries(built) }))
		await rename(CACHE + ".tmp", CACHE)
		return built
	} catch (error) {
		console.error(
			`[oc-models-pro] artificial analysis not refreshed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return previous ? fromCache(previous) : new Map()
	}
}

// Self-check: node plugins/oc-models-pro/aa.ts --self-check
if (process.argv[2] === "--self-check") {
	const run = async () => {
		// The mapping is the part that can be wrong without anyone noticing, so it is tested against
		// their documented response shape — no key, no spend, no network.
		const canned = {
			data: [
				{ name: "o3-mini", slug: "o3-mini", median_output_tokens_per_second: 153.831 },
				{ name: "Claude Fable 5", slug: "claude-fable-5", median_output_tokens_per_second: 69.6 },
				{ name: "Foo", slug: "foo", median_output_tokens_per_second: 40 },
				{ name: "Foo Latest", slug: "foo-latest", median_output_tokens_per_second: 90 },
				{ name: "no speed", slug: "no-speed" },
				{ name: "zero", slug: "zero", median_output_tokens_per_second: 0 },
			],
		}
		const index = buildIndex(canned)
		if (index.get(benchKey("o3-mini")) !== 153.831) throw new Error("self-check: o3-mini not mapped")
		if (index.get("claude-fable-5") !== 69.6) throw new Error("self-check: slug not mapped")
		if (index.has("no-speed") || index.has("zero")) throw new Error("self-check: an entry without a speed was mapped")
		if (index.get(benchKey("Foo")) !== 90) throw new Error("self-check: two entries on one key did not keep the faster")
		if (!apiKey()) {
			console.log("self-check ok: mapping holds; no ARTIFICIAL_ANALYSIS_API_KEY, live path not exercised")
			return
		}
		const live = await aaIndex()
		if (live.size === 0) throw new Error("self-check: a key is set but nothing came back")
		console.log("self-check ok: mapping holds; live " + live.size + " models keyed")
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
