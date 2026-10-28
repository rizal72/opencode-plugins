// oc-models-pro — server half, for the desktop.
//
// The terminal reads the catalogue and the four sources in-process. A plugin window cannot: `bun:sqlite`,
// `node:fs` and the three fetches are all outside its reach — and the AA key lives in this process's
// environment, which is where the server has it and the window does not. So the whole table is assembled
// here and the window asks for it over `models.snapshot`.
//
// The rows are the terminal's, field for field, so the two views can be compared: same catalogue, same
// credits, same speeds. Only the rendering differs.
import { Plugin } from "@opencode/plugin"

import { aaIndex } from "./aa.ts"
import { benchFor, benchIndex, benchKey, type Bench } from "./bench.ts"
import { credits, goPlan, key as creditKey, nativePeak, type Credits } from "./multipliers.ts"
import { prefKey, readFavourites, toggleFavorite } from "./prefs.ts"
import { tagsFor } from "./tags.ts"
import { speedIndex } from "./tps.ts"
import { Models, type ModelsSnapshot } from "./rpc.ts"
import type { Row } from "./rows.ts"

/**
 * The fetch-backed sources refresh on their own TTLs (6 h, 1 day, 6 h); the measured speeds cost about a
 * second here and are worth keeping for a minute, which is also what keeps a poll cheap.
 */
const CACHE_MS = 60_000

const isGo = (providerID: string) => providerID === "opencode-go"

interface Sources {
	bench?: Map<string, Bench>
	credits?: Map<string, Credits>
	creditsKnown: boolean
	estimated?: Map<string, number>
	measured?: Map<string, number>
}

export default Plugin.define({
	id: "oc-models-pro",
	async setup(ctx) {
		let cache: { at: number; value: ModelsSnapshot } | undefined

		/** The four sources, each failure named instead of swallowed: a thin column must look thin. */
		async function sources(problems: string[]): Promise<Sources> {
			const [plan, bench, estimates, speeds] = await Promise.allSettled([
				goPlan(),
				benchIndex(),
				aaIndex(),
				speedIndex(),
			])
			const out: Sources = { creditsKnown: false }
			if (plan.status === "fulfilled" && plan.value) {
				out.credits = credits(plan.value)
				out.creditsKnown = true
			} else problems.push("go plan: no credit multipliers")
			if (bench.status === "fulfilled") out.bench = bench.value
			else problems.push("bench: no intelligence")
			if (estimates.status === "fulfilled") out.estimated = estimates.value
			else problems.push("aa: no borrowed speed")
			if (speeds.status === "fulfilled")
				out.measured = new Map([...speeds.value.speeds].map(([key, speed]) => [key, speed.tps]))
			else problems.push("measured: the session store could not be read")
			return out
		}

		async function build(force: boolean): Promise<ModelsSnapshot> {
			if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value

			const problems: string[] = []
			const [models, providers, src] = await Promise.all([
				ctx.model.list({}),
				ctx.provider.list({}),
				sources(problems),
			])
			const offers: any[] = (models as any)?.data ?? (models as any) ?? []
			const names = new Map<string, string>(
				(((providers as any)?.data ?? (providers as any) ?? []) as any[]).map((provider) => [
					provider.id,
					provider.name,
				]),
			)
			const tags = tagsFor([...names].map(([id, name]) => ({ id, name })))

			const rows: Row[] = []
			let withSpeed = 0
			for (const model of offers) {
				const cost = (model.cost ?? []).find((entry: any) => !entry.tier) ?? model.cost?.[0]
				const limit = model.limit ?? {}
				const score = benchFor(src.bench ?? new Map(), model.name, model.modelID)
				// Three sources, one order: what this machine measured, then Artificial Analysis, then the
				// catalogue. A measured figure is never displaced by an estimate.
				const mine = src.measured?.get(model.providerID + "/" + model.modelID)
				const theirs =
					mine === undefined
						? (src.estimated?.get(benchKey(model.name)) ?? src.estimated?.get(benchKey(model.modelID)) ?? score?.tps)
						: undefined
				if (mine !== undefined || theirs !== undefined) withSpeed += 1
				// The measured ratio from the Go plan page first, the native rule second: one is data, the
				// other is the fact no table reports (the catalogue lists a single DeepSeek price).
				const planPeak = isGo(model.providerID) ? src.credits?.get(creditKey(model.modelID))?.peak : undefined
				const peak = planPeak ?? nativePeak(model.providerID)
				rows.push({
					providerID: model.providerID,
					modelID: model.modelID,
					name: model.name,
					provider: (names.get(model.providerID) ?? model.providerID).replace(/^(.+?) \/ (.+)$/, "$2 ($1)"),
					tag: tags.get(model.providerID) ?? model.providerID.slice(0, 2).toUpperCase(),
					...(typeof cost?.input === "number" ? { input: cost.input } : {}),
					...(typeof cost?.output === "number" ? { output: cost.output } : {}),
					...(typeof limit.context === "number" ? { context: limit.context } : {}),
					credit: isGo(model.providerID) ? (src.credits?.get(creditKey(model.modelID))?.credit ?? 1) : 1,
					...(isGo(model.providerID) && src.credits?.get(creditKey(model.modelID))?.promo !== undefined
						? { promo: src.credits.get(creditKey(model.modelID))!.promo }
						: {}),
					...(peak !== undefined ? { peak } : {}),
					...(score?.int !== undefined ? { int: score.int } : {}),
					...(theirs !== undefined ? { tps: theirs } : {}),
					...(mine !== undefined ? { measured: mine } : {}),
					enabled: model.enabled !== false,
				})
			}

			const favourites = readFavourites()
			if (!favourites) problems.push("model.json: favourites unreadable")
			const value: ModelsSnapshot = {
				rows,
				favorites: (favourites ?? []).map((entry) => prefKey(entry.providerID, entry.modelID)),
				offers: offers.length,
				withSpeed,
				credits: src.creditsKnown,
				...(problems.length ? { problems } : {}),
			}
			cache = { at: Date.now(), value }
			return value
		}

		await ctx.rpc.register(Models, {
			snapshot: async (input: any) => build(input?.force === true),
			setFavorite: async (input: any) => {
				const on = toggleFavorite(String(input.providerID), String(input.modelID), input.on)
				// The rows carry no favourite flag, so the cache stays usable; the list is the only thing that moved.
				const favourites = readFavourites() ?? []
				const favorites = favourites.map((entry) => prefKey(entry.providerID, entry.modelID))
				if (cache) cache = { at: cache.at, value: { ...cache.value, favorites } }
				return { ok: on !== undefined, favorites }
			},
		})
	},
})
