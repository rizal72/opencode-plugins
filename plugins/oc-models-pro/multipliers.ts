// oc-models-pro: what the Go plan gives per model, read from Go's own model catalogue.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/multipliers.ts --self-check

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/** Ids, monthly allowances and tariff steps: what the catalogue serves Go's own clients. */
export const MODELS = "https://opencode.ai/inference/go/v1/models"
/** The catalogue carries no plan price; the docs page's plan table is the only place it is written. */
export const PRICE_PAGE = "https://opencode.ai/v2/docs/console/go/"

export interface GoModel {
	/** The catalogue's own id, which is `opencode-go/<id>` without the provider prefix. */
	id: string
	/** Monthly allowance in dollars on Go; the promoted figure when one is running. */
	limit: number
	/** The largest recurring tariff step the catalogue declares, when it declares one. */
	peak?: number
}

export interface GoPlan {
	/** Plan price in dollars per month. */
	price: number
	models: GoModel[]
}

/** One read of the plan: the figures, the day they come from, and whether today's fetch failed. */
export interface GoPlanSnapshot {
	plan: GoPlan
	/** `YYYY-MM-DD`, the day the figures were fetched: older than today means the copy was kept. */
	fetched: string
	/** True when the live read failed and the cache answered instead. */
	stale: boolean
}

/** What one model is worth on the plan, for the row note and for the ordering. */
export interface Credits {
	/** Monthly limit ÷ plan price. */
	credit: number
	/** Peak input price ÷ off-peak input price, for a model with two tariffs. */
	peak?: number
}

/** The native DeepSeek tariff doubles at peak, and the catalogue lists the **off-peak** figure, so the
 *  note is static: this function only knows which *list* price doubles. */
export function nativePeak(providerID: string): number | undefined {
	return providerID === "deepseek" ? 2 : undefined
}

const CACHE_DIR = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
const CACHE = join(CACHE_DIR, "oc-models-pro", "go-limits.json")

function text(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim()
}

/** The plan price, from the row whose first cell names the standard plan: a table reordered to put
 *  Go Plus first must not halve every credit. */
export function parsePlanPrice(html: string): number | undefined {
	for (const raw of html.split(/<tr[\s>]/i).slice(1)) {
		const row = raw.split(/<\/tr>/i)[0] ?? ""
		const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
		if (cells.length < 2 || text(cells[0] ?? "").toLowerCase() !== "go") continue
		const found = text(cells[1] ?? "").match(/\$\s?([\d.]+)\s*\/\s*month/i)
		return found ? Number(found[1]) : undefined
	}
	return undefined
}

interface ApiModel {
	id?: string
	go?: { monthly_usage?: { go?: number } }
	cost?: { multipliers?: { when?: unknown; factor?: number }[] }
}

function carries(when: unknown, field: string): boolean {
	if (!when || typeof when !== "object") return false
	const record = when as Record<string, unknown>
	if (field in record) return true
	return Object.values(record).some((value) => carries(value, field))
}

/** A peak is a tariff that steps up inside the day. A factor bound to a `date` is a price change
 *  scheduled upstream for that day, and one bound to both is still the second: neither is a peak. */
function recurring(when: unknown): boolean {
	return carries(when, "utc_hours") && !carries(when, "date")
}

/** The paid rows and their allowance; a model offered on no Go plan carries none and is skipped.
 *
 *  A `monthly_usage.go` that is not a number is a different thing from a missing one: the first is the
 *  source changing shape under a row that should have had an allowance, and it throws so the refresh
 *  keeps yesterday's copy and says it is stale, instead of writing a plan with a hole in it. */
export function parseGoModels(json: string): GoModel[] {
	let data: ApiModel[] | undefined
	try {
		data = (JSON.parse(json) as { data?: ApiModel[] }).data
	} catch {
		return []
	}
	if (!Array.isArray(data)) return []
	const models: GoModel[] = []
	const seen = new Set<string>()
	for (const model of data) {
		const monthly = model.go?.monthly_usage
		if (!monthly) continue
		const limit = monthly.go
		if (limit === undefined || limit === 0) continue
		if (typeof model.id !== "string" || model.id.length === 0) throw new Error("a Go allowance with no id")
		if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
			throw new Error(model.id + ": allowance is not a positive number")
		}
		if (seen.has(model.id)) throw new Error(model.id + ": id appears twice")
		seen.add(model.id)
		// A step of 1x is no note at all.
		const factors = (model.cost?.multipliers ?? [])
			.filter((entry) => recurring(entry.when))
			.map((entry) => entry.factor)
			.filter((factor): factor is number => typeof factor === "number" && factor > 1)
		models.push({ id: model.id, limit, ...(factors.length ? { peak: Math.max(...factors) } : {}) })
	}
	return models
}

export function credits(plan: GoPlan): Map<string, Credits> {
	const result = new Map<string, Credits>()
	if (!plan.price) return result
	for (const model of plan.models) {
		result.set(model.id, {
			credit: Math.round((model.limit / plan.price) * 10) / 10,
			...(model.peak !== undefined ? { peak: model.peak } : {}),
		})
	}
	return result
}

function today(): string {
	return new Date().toLocaleDateString("en-CA")
}

async function cached(): Promise<{ fetched: string; plan: GoPlan } | undefined> {
	try {
		const parsed = JSON.parse(await readFile(CACHE, "utf8")) as { fetched: string; plan: GoPlan }
		// A cache written before the catalogue source holds `limits` by display name, and is not this shape.
		return Array.isArray(parsed.plan?.models) ? parsed : undefined
	} catch {
		return undefined
	}
}

/** A day of grace, and the day is named: a copy older than today is served, but the caller has to say
 *  so, or a source that moved once stays invisible forever. */
export async function goPlan(): Promise<GoPlanSnapshot | undefined> {
	const previous = await cached()
	if (previous?.fetched === today()) return { plan: previous.plan, fetched: previous.fetched, stale: false }
	const day = today()
	try {
		const [models, price] = await Promise.all([
			fetch(MODELS, { headers: { "user-agent": "oc-models-pro" }, signal: AbortSignal.timeout(20_000) }),
			fetch(PRICE_PAGE, { headers: { "user-agent": "oc-models-pro" }, signal: AbortSignal.timeout(20_000) }),
		])
		if (!models.ok) throw new Error("models: HTTP " + models.status)
		if (!price.ok) throw new Error("price: HTTP " + price.status)
		const list = parseGoModels(await models.text())
		const planPrice = parsePlanPrice(await price.text())
		if (list.length === 0 || !planPrice) throw new Error("source shape changed")
		const plan = { price: planPrice, models: list }
		await mkdir(dirname(CACHE), { recursive: true })
		await writeFile(CACHE + ".tmp", JSON.stringify({ fetched: day, plan }))
		await rename(CACHE + ".tmp", CACHE)
		return { plan, fetched: day, stale: false }
	} catch (error) {
		console.error(`[oc-models-pro] Go plan not refreshed: ${error instanceof Error ? error.message : String(error)}`)
		return previous ? { plan: previous.plan, fetched: previous.fetched, stale: true } : undefined
	}
}

// Self-check: node plugins/oc-models-pro/multipliers.ts --self-check
//
// A probe of the live source, before a release: no model is named here. What it checks is the shape of
// the contract (every paid row arrives, every credit is recomputed from its own allowance), not a
// figure anyone wrote down, and the rules behind the columns are the fixtures in multipliers.test.ts.
if (process.argv[2] === "--self-check") {
	const run = async () => {
		const [models, price] = await Promise.all([
			fetch(MODELS, { signal: AbortSignal.timeout(20_000) }),
			fetch(PRICE_PAGE, { signal: AbortSignal.timeout(20_000) }),
		])
		if (!models.ok) throw new Error("self-check: models HTTP " + models.status)
		if (!price.ok) throw new Error("self-check: price HTTP " + price.status)
		const payload = (await models.json()) as { data?: ApiModel[] }
		const data = payload.data ?? []
		const list = parseGoModels(JSON.stringify(payload))
		const planPrice = parsePlanPrice(await price.text())
		if (!planPrice) throw new Error("self-check: plan price not found")
		// The raw rows are the only reference: counting them is not enough, the parser is checked
		// against them one by one, by id and by allowance, so an invented or a dropped row fails.
		const paid = new Map<string, number>()
		for (const model of data) {
			const limit = model.go?.monthly_usage?.go
			if (model.id && typeof limit === "number" && limit > 0) paid.set(model.id, limit)
		}
		if (list.length !== paid.size) throw new Error("self-check: " + list.length + " of " + paid.size + " paid models parsed")
		if (new Set(list.map((model) => model.id)).size !== list.length) throw new Error("self-check: duplicate ids")
		const table = credits({ price: planPrice, models: list })
		if (table.size !== list.length) throw new Error("self-check: " + table.size + " of " + list.length + " models keyed")
		let peaks = 0
		for (const model of list) {
			const allowance = paid.get(model.id)
			if (allowance === undefined) throw new Error("self-check: " + model.id + " is not a paid row of the catalogue")
			if (allowance !== model.limit) throw new Error("self-check: " + model.id + " allowance does not follow its row")
			const entry = table.get(model.id)
			if (Math.round((allowance / planPrice) * 10) / 10 !== entry?.credit) {
				throw new Error("self-check: " + model.id + " credit does not follow its allowance")
			}
			if (entry?.peak) peaks += 1
		}
		// A flat catalogue is not a fault, so no peak is reported rather than thrown.
		console.log(
			"self-check ok: plan $" + planPrice + "/month, " + table.size + " models with an allowance, " +
				peaks + " with a peak tariff",
		)
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
