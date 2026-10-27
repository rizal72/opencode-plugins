// oc-models-pro: intelligence per model, from the stencil.so catalog.
//
// The catalog is keyed by gateway and its ids are qualified (`alibaba/deepseek-v4.1-flash`), so the
// comparison uses the last segment — and the key is built from *our* model's display name, never its
// id. That is what makes the aliases meet: the same model is `deepseek/deepseek-flash` here and
// "DeepSeek V4.1 Flash 1017" to the eye, while stencil calls it `deepseek-v4.1-flash`. The name is
// stripped of the labels a catalogue attaches (`latest`, `contributor`, `free`, `preview`) and of
// snapshot stamps (`1017`, `0731`); the model id is the fallback when the name finds nothing.
//
// `int` is on 4612 of 9050 entries; `tps` is on none of them today (measured 2026-10-19), so the
// speed column stands empty until a source carries it. A figure that is not there is never guessed.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/bench.ts --self-check

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const CATALOG = "https://catalog.stencil.so/models.json"

const CACHE_DIR = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
const CACHE = join(CACHE_DIR, "oc-models-pro", "bench.json")
const GRACE_MS = 6 * 60 * 60 * 1000

export interface Bench {
	int: number
	tps?: number
}

interface Cached {
	fetched: number
	index: Record<string, Bench>
}

/** Labels a catalogue attaches to a model that are not part of its name. */
const LABELS = "-(?:latest|contributor|free|preview|exp|thinking)$"

/**
 * "DeepSeek V4.1 Flash 1017" and `deepseek-v4.1-flash` have to meet somewhere: this is the meeting
 * point. Labels and snapshot stamps come off in two rounds, since one can hide the other.
 */
export function benchKey(name: string): string {
	let key = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
	for (let round = 0; round < 2; round++) {
		key = key.replace(new RegExp(LABELS, "g"), "")
		// Four-digit floor, and never below four characters left: a real model number must survive.
		key = key.replace(/-\d{4,6}$/, (stamp) => (key.length - stamp.length >= 4 ? "" : stamp))
	}
	return key.replace(/^-|-$/g, "")
}

export function buildIndex(catalog: Record<string, any>): Map<string, Bench> {
	const index = new Map<string, Bench>()
	for (const provider of Object.values(catalog)) {
		for (const [id, meta] of Object.entries((provider as any)?.models ?? {})) {
			const int = (meta as any)?.int
			if (typeof int !== "number") continue
			const key = benchKey(String(id).split("/").pop() ?? "")
			if (!key) continue
			const tps = (meta as any)?.tps
			// A key met twice keeps the first row's int but takes the first speed that exists: the same
			// model on several gateways is scored once, and the score without the figure must not hide it.
			const previous = index.get(key)
			if (!previous) index.set(key, { int, tps: typeof tps === "number" ? tps : undefined })
			else if (previous.tps === undefined && typeof tps === "number")
				index.set(key, { int: previous.int, tps })
		}
	}
	return index
}

function indexOf(cached: Cached): Map<string, Bench> {
	return new Map(Object.entries(cached.index ?? {}))
}

async function cached(): Promise<Cached | undefined> {
	try {
		return JSON.parse(await readFile(CACHE, "utf8")) as Cached
	} catch {
		return undefined
	}
}

/** Six hours of grace: a benchmark does not move between two coffee breaks. */
export async function benchIndex(): Promise<Map<string, Bench>> {
	const previous = await cached()
	if (previous && Date.now() - previous.fetched < GRACE_MS) return indexOf(previous)
	try {
		const response = await fetch(CATALOG, { headers: { "user-agent": "oc-models-pro" } })
		if (!response.ok) throw new Error("HTTP " + response.status)
		const built = buildIndex(await response.json())
		if (built.size === 0) throw new Error("catalog shape changed")
		await mkdir(dirname(CACHE), { recursive: true })
		await writeFile(CACHE + ".tmp", JSON.stringify({ fetched: Date.now(), index: Object.fromEntries(built) }))
		await rename(CACHE + ".tmp", CACHE)
		return built
	} catch (error) {
		console.error(
			`[oc-models-pro] benchmarks not refreshed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return previous ? indexOf(previous) : new Map()
	}
}

/** Name first, id second: the name carries the model, the id carries the provider's label for it. */
export function benchFor(index: Map<string, Bench>, name: string, id: string): Bench | undefined {
	return index.get(benchKey(name)) ?? index.get(benchKey(id))
}

// Self-check: node plugins/oc-models-pro/bench.ts --self-check
if (process.argv[2] === "--self-check") {
	const run = async () => {
		const response = await fetch(CATALOG)
		if (!response.ok) throw new Error("self-check: HTTP " + response.status)
		const index = buildIndex(await response.json())
		if (index.size < 200) throw new Error("self-check: only " + index.size + " models keyed")
		const cases: Array<[string, string, number]> = [
			["DeepSeek V4.1 Flash 1017", "deepseek-flash", 39.5],
			["DeepSeek V4 Flash Latest", "deepseek-v4-flash-latest", 34.3],
			["Muse Spark 1.3 Contributor", "muse-spark-1.3-contributor", 48.1],
			["Gemini 4 Argon Contributor", "gemini-4-argon-contributor", 52.6],
		]
		const misses = cases.filter(([name, id, int]) => benchFor(index, name, id)?.int !== int)
		if (misses.length) {
			throw new Error("self-check: " + misses.map(([name]) => name).join(", ") + " did not match")
		}
		// The label must not swallow a model that is only labelled: the contributor shares the
		// underlying model's score, but a different model must not inherit one.
		if (benchFor(index, "MiMo V2.5", "mimo-v2.5")) throw new Error("self-check: MiMo V2.5 matched something")
		console.log(
			"self-check ok: " + index.size + " models keyed, DeepSeek -> " +
				benchFor(index, "DeepSeek V4.1 Flash 1017", "deepseek-flash")!.int,
		)
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
