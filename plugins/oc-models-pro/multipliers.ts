// oc-models-pro: what the Go plan gives per model, read from the live Go docs page.
//
// The table is server-rendered — no JS, no auth — so a plain fetch and a row regex are enough. The
// mirror that would have been cleaner, the `.mdx` on GitHub, is stale by design: it carries the old
// limits (a model at $60 where the deployed page says $80), so the page is the source and the cache
// carries the date it was read.
//
// Two different figures live on that page, and confusing them was the first bug here:
//   - the **credit multiplier**: monthly limit ÷ plan price (DeepSeek V4.1 Flash: $80 on a $10 plan =
//     8x). Every model has one, and it is what orders the list by effective price;
//   - the **promotion note** (`4x · Limited time`): limit ÷ the struck-through base, i.e. this model's
//     allowance is 4x its normal one. Only a few rows carry it.
//
// The page has no model ids, rows match by display name; a model with two tariffs appears twice
// (`… (Off-Peak)` / `… (Peak)`), and the table repeats per plan (`go`, `go-plus`) — the first
// occurrence wins, so the values are the standard plan's.
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/multipliers.ts --self-check

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const PAGE = "https://opencode.ai/v2/docs/console/go/"

export interface GoLimit {
	/** Display name as the page writes it; the only key it offers. */
	name: string
	input?: number
	output?: number
	cacheRead?: number
	cacheWrite?: number
	/** Monthly limit in dollars: the promoted value when the cell carries one. */
	limit?: number
	/** The struck-through value a promotion replaces. */
	base?: number
	/** The page's own `4x` note; `1` when it says nothing. */
	multiplier: number
}

export interface GoPlan {
	/** Plan price in dollars per month. */
	price: number
	limits: GoLimit[]
}

/** What one model is worth on the plan, for the row note and for the ordering. */
export interface Credits {
	/** Monthly limit ÷ plan price. */
	credit: number
	/** limit ÷ base, when the page marks a promotion. */
	promo?: number
	/** Peak input price ÷ off-peak input price, for a model with two tariffs. */
	peak?: number
}

const CACHE = join(homedir(), ".cache", "oc-models-pro", "go-limits.json")

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

function money(html: string): number | undefined {
	const plain = text(html)
	// Free models print the word, not a figure.
	if (/free/i.test(plain)) return 0
	const found = plain.match(/\$([\d.]+)/)
	return found ? Number(found[1]) : undefined
}

function multiplierOf(html: string): number {
	const found = html.match(/([\d.]+)\s*[x×]/i)
	return found ? Number(found[1]) : 1
}

export function parseGoTable(html: string): GoLimit[] {
	const rows = html.split(/<tr[\s>]/i).slice(1)
	const limits: GoLimit[] = []
	const seen = new Set<string>()
	for (const raw of rows) {
		const row = raw.split(/<\/tr>/i)[0] ?? ""
		const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []
		if (cells.length < 6) continue
		const name = text(cells[0] ?? "")
		if (!name || /^model$/i.test(name)) continue
		// The table repeats per plan; the first panel is the standard one.
		if (seen.has(name)) continue
		seen.add(name)
		const monthly = cells[5] ?? ""
		const promoted = monthly.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
		const struck = monthly.match(/<del[^>]*>([\s\S]*?)<\/del>/i)
		limits.push({
			name,
			input: money(cells[1] ?? ""),
			output: money(cells[2] ?? ""),
			cacheRead: money(cells[3] ?? ""),
			cacheWrite: money(cells[4] ?? ""),
			limit: money(promoted ? promoted[1] : monthly),
			base: struck ? money(struck[1]) : undefined,
			multiplier: multiplierOf(monthly),
		})
	}
	return limits
}

/** The plan price, `$10/month` in the `Go` heading; the first such figure on the page is Go's. */
export function parsePlanPrice(html: string): number | undefined {
	const found = text(html).match(/\$\s?([\d.]+)\s*\/\s*month/i)
	return found ? Number(found[1]) : undefined
}

/** "… (Off-Peak)" and "… (Peak)" are one model; the tariff is not part of its name. */
export function baseName(name: string): string {
	return name.replace(/\s*\((?:off-?peak|peak)\)\s*$/i, "").trim()
}

/** "GLM-5.3-Flash" and "glm-5.3-flash" have to meet somewhere: this is the meeting point. */
export function key(name: string): string {
	return baseName(name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

export function credits(plan: GoPlan): Map<string, Credits> {
	const grouped = new Map<string, GoLimit[]>()
	for (const row of plan.limits) {
		const id = key(row.name)
		grouped.set(id, [...(grouped.get(id) ?? []), row])
	}
	const result = new Map<string, Credits>()
	for (const [id, rows] of grouped) {
		const off = rows.find((row) => /off-?peak/i.test(row.name)) ?? rows[0]
		const peak = rows.find((row) => /peak/i.test(row.name) && !/off-?peak/i.test(row.name))
		if (!off?.limit || !plan.price) continue
		result.set(id, {
			credit: Math.round((off.limit / plan.price) * 10) / 10,
			promo: off.base && off.base > 0 ? Math.round((off.limit / off.base) * 10) / 10 : undefined,
			peak: peak?.input && off.input ? Math.round(((peak.input / off.input) * 10)) / 10 : undefined,
		})
	}
	return result
}

function today(): string {
	return new Date().toLocaleDateString("en-CA")
}

async function cached(): Promise<{ fetched: string; plan: GoPlan } | undefined> {
	try {
		return JSON.parse(await readFile(CACHE, "utf8")) as { fetched: string; plan: GoPlan }
	} catch {
		return undefined
	}
}

/** A day of grace: a promotion does not change hourly, and a stale copy beats no column. */
export async function goPlan(): Promise<GoPlan | undefined> {
	const previous = await cached()
	if (previous?.fetched === today()) return previous.plan
	try {
		const response = await fetch(PAGE, {
			headers: { "user-agent": "oc-models-pro" },
			signal: AbortSignal.timeout(20_000),
		})
		if (!response.ok) throw new Error("HTTP " + response.status)
		const html = await response.text()
		const limits = parseGoTable(html)
		const price = parsePlanPrice(html)
		if (limits.length === 0 || !price) throw new Error("page shape changed")
		const plan = { price, limits }
		await mkdir(dirname(CACHE), { recursive: true })
		await writeFile(CACHE + ".tmp", JSON.stringify({ fetched: today(), plan }))
		await rename(CACHE + ".tmp", CACHE)
		return plan
	} catch (error) {
		console.error(`[oc-models-pro] Go plan not refreshed: ${error instanceof Error ? error.message : String(error)}`)
		return previous?.plan
	}
}

// Self-check: node plugins/oc-models-pro/multipliers.ts --self-check
if (process.argv[2] === "--self-check") {
	const run = async () => {
		const response = await fetch(PAGE)
		if (!response.ok) throw new Error("self-check: HTTP " + response.status)
		const html = await response.text()
		const limits = parseGoTable(html)
		const price = parsePlanPrice(html)
		if (limits.length < 10) throw new Error("self-check: only " + limits.length + " rows parsed")
		if (!price) throw new Error("self-check: plan price not found")
		if (limits.some((l) => typeof l.input !== "number" || typeof l.output !== "number")) {
			throw new Error("self-check: a row lost its price")
		}
		if (new Set(limits.map((l) => l.name)).size !== limits.length) throw new Error("self-check: duplicate names")
		const table = credits({ price, limits })
		if (table.size < 10) throw new Error("self-check: only " + table.size + " models keyed")
		const promoted = [...table.values()].filter((c) => c.promo)
		if (promoted.length === 0) throw new Error("self-check: no promotion found")
		const deepseek = table.get("deepseek-v4-1-flash") ?? table.get("deepseek-v4.1-flash")
		if (!deepseek) throw new Error("self-check: DeepSeek V4.1 Flash not matched")
		if (Math.round(deepseek.credit) !== 8) throw new Error("self-check: DeepSeek credit is " + deepseek.credit)
		if (!deepseek.peak) throw new Error("self-check: DeepSeek peak tariff lost")
		console.log(
			"self-check ok: plan $" + price + "/month, " + table.size + " models, " + promoted.length +
				" promoted, DeepSeek V4.1 Flash -> $" + (8 * price) + " limit = " + deepseek.credit +
				"x, peak " + deepseek.peak + "x",
		)
	}
	run().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}
