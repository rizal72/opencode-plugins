// oc-models-pro — the model list with prices, ported from Pi's `pi-model-pro`.
//
// We render it ourselves, in a `session.panel`: the native dialog caps an option line at 60 columns,
// measured, which cannot hold prices, context, intelligence and the Go credit side by side. The host
// owns the panel's placement and focus; the list owns its columns.
//
// Prices are native, never adjusted: the multiplier gets its own column and the effective price only
// decides the order, so a promoted model sorts first while the figures stay honest. The model in use
// is the first row whatever it costs: the free/paying split never buries it.
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { appendFileSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { benchFor, benchIndex, type Bench } from "./bench.ts"
import { credits, goPlan, key, type Credits } from "./multipliers.ts"
import { LEGEND_MIN, fit, hintLines, rowWidth, type Fit } from "./fit.ts"

interface Row {
	name: string
	providerID: string
	modelID: string
	provider: string
	/** Undefined when the catalogue has no price for the model: an unknown figure, not a free one. */
	input?: number
	output?: number
	/** Undefined when the model carries no limit. */
	context?: number
	/** Monthly limit ÷ the $10 plan: the ordering multiplier, shown so the order explains itself. */
	credit: number
	/** Allowance ÷ its normal one, when the page marks a promotion. */
	promo?: number
	/** Peak price ÷ off-peak price, for a model with two tariffs. */
	peak?: number
	/** Stencil's intelligence score and its speed; absent when the catalogue has no row for the model. */
	int?: number
	tps?: number
	enabled: boolean
}

interface Item {
	header?: string
	row?: Row
}

type Scope = "all" | "favorites" | "paying"
const SCOPES: Scope[] = ["all", "favorites", "paying"]

const prefKey = (providerID: string, modelID: string): string => providerID + "/" + modelID

/** The picker's own state file: `favorite[]` and `recent[]` are `{ providerID, modelID }`. */
interface Prefs {
	favorite: Set<string>
	recent: Map<string, number>
	/** `variant{ "provider/model": "high" }`: a saved variant per model, "default" included. */
	variants: Map<string, string>
}

const PREFS_FILE = join(homedir(), ".local/state/opencode/model.json")
/** Same directory, a leading dot: the host watches `model.json.*`, not this. */
const TEMP_FILE = join(homedir(), ".local/state/opencode", ".model.json.tmp")
let prefs: Prefs = { favorite: new Set(), recent: new Map(), variants: new Map() }

/** The host's `favorite[]` as it is in the file: a key cannot be split back — a model id may hold a slash. */
function readFavourites(): { providerID: string; modelID: string }[] | undefined {
	try {
		const data = JSON.parse(readFileSync(PREFS_FILE, "utf8"))
		if (!Array.isArray(data.favorite)) return []
		return data.favorite.filter(
			(entry: any) => typeof entry?.providerID === "string" && typeof entry?.modelID === "string",
		)
	} catch (error) {
		// A missing file is not an error: starting empty creates it on the write. Anything else is.
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return []
		trace("favourites: " + (error instanceof Error ? error.message : String(error)))
		return undefined
	}
}

/** Rewrites `favorite[]` with the rest of the file untouched. The host watches this path and
 *  `model.json.*`, so the atomic rename is seen and the native picker, `model.cycle_favorite` and this
 *  list stay in step; a dot in front keeps the temp name outside that glob. */
function writeFavourites(list: { providerID: string; modelID: string }[]): boolean {
	try {
		let raw: any
		try {
			raw = JSON.parse(readFileSync(PREFS_FILE, "utf8"))
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
			raw = {}
		}
		raw.favorite = list
		writeFileSync(TEMP_FILE, JSON.stringify(raw))
		renameSync(TEMP_FILE, PREFS_FILE)
		return true
	} catch (error) {
		trace("favourites: " + (error instanceof Error ? error.message : String(error)))
		return false
	}
}

function toggleFavorite(providerID: string, modelID: string): boolean | undefined {
	const key = prefKey(providerID, modelID)
	const list = readFavourites()
	if (!list) return undefined
	const kept = list.filter((entry) => prefKey(entry.providerID, entry.modelID) !== key)
	const on = kept.length === list.length
	return writeFavourites(on ? [...kept, { providerID, modelID }] : kept) ? on : undefined
}

function readPrefs(): Prefs {
	const parsed: Prefs = { favorite: new Set(), recent: new Map(), variants: new Map() }
	try {
		const data = JSON.parse(readFileSync(PREFS_FILE, "utf8"))
		for (const entry of data.favorite ?? []) parsed.favorite.add(prefKey(entry.providerID, entry.modelID))
		for (const [index, entry] of (data.recent ?? []).entries())
			parsed.recent.set(prefKey(entry.providerID, entry.modelID), index)
		for (const [model, variant] of Object.entries(data.variant ?? {}))
			if (typeof variant === "string") parsed.variants.set(model, variant)
	} catch (error) {
		// A corrupt state file empties the favourites and the recent list: say so instead of pretending.
		trace("prefs unreadable: " + (error instanceof Error ? error.message : String(error)))
	}
	return parsed
}

/** What the Go plan makes a model cost: the figure the effective order sorts by. An unknown price is
 *  not zero — it sorts last, or it would sit at the top of the cheapest list forever. */
function effective(row: Row): number {
	if (row.input === undefined) return Number.POSITIVE_INFINITY
	return row.input / (row.credit || 1)
}

const SORTS = [
	{ label: "effective price", short: "effective↑", value: effective },
	{ label: "input price", short: "in↑", value: (row: Row) => row.input ?? Number.POSITIVE_INFINITY },
	{ label: "output price", short: "out↑", value: (row: Row) => row.output ?? Number.POSITIVE_INFINITY },
	{
		label: "input + output",
		short: "in+out↑",
		value: (row: Row) =>
			row.input === undefined || row.output === undefined
				? Number.POSITIVE_INFINITY
				: (row.input + row.output) / (row.credit || 1),
	},
	{
		label: "context window",
		short: "ctx↓",
		value: (row: Row) => (row.context === undefined ? Number.POSITIVE_INFINITY : -row.context),
	},
	// A missing score sorts last, never first: Pi's rule, and the honest one.
	{ label: "intelligence", short: "int↓", value: (row: Row) => -(row.int ?? -1) },
	{ label: "speed", short: "speed↓", value: (row: Row) => -(row.tps ?? -1) },
	{
		label: "recently used",
		short: "recent",
		value: (row: Row) => prefs.recent.get(prefKey(row.providerID, row.modelID)) ?? 1e9,
	},
	{ label: "name", short: "name", value: (row: Row) => 0 },
] as const

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_DIM = "#8a8a8a"
const FALLBACK_ACCENT = "#5a9fd4"

function tokens(value: number | undefined): string {
	if (value === undefined) return ""
	if (value >= 1_000_000) return Math.round(value / 1_000_000) + "M"
	if (value >= 1000) return Math.round(value / 1000) + "k"
	return String(value)
}

/**
 * Every cell is exactly `width` characters: text that does not fit is cut, never shifted right. The
 * columns are hand-padded monospace, so one `padStart` short of its width slides the whole row.
 */
function cell(text: string, width: number, align: "start" | "end" = "end"): string {
	const cut = text.length > width ? text.slice(0, width) : text
	return align === "end" ? cut.padStart(width) : cut.padEnd(width)
}

/** Two letters, so a row carries its provider without a column that eats the width. */
const TAGS: Record<string, string> = {
	opencode: "OC",
	"opencode-go": "GO",
	openrouter: "OR",
	deepseek: "DS",
}

function tag(providerID: string): string {
	// Always four characters, even for a one-letter provider id, or the name column shifts left.
	return ((TAGS[providerID] ?? providerID.slice(0, 2)).toUpperCase().padEnd(2) + "  ").slice(0, 4)
}

/**
 * Column widths live in `fit.ts`: they are no longer fixed. The table is 85 characters at its widest
 * and the name gives way first (down to 24), then whole columns go. `panel.width` reads as pixels
 * on the first render, so `fit` clamps anything implausible back to the wide layout.
 */
function label(name: string, width: number): string {
	return name.length > width ? name.slice(0, width - 1) + "…" : name.padEnd(width)
}

/** A price cell; blank when the catalogue has no figure, "free" when the figure is zero. */
function price(value: number | undefined, width: number): string {
	if (value === undefined) return cell("", width)
	const shown = value === 0 ? "free" : String(Math.round(value * 1000) / 1000)
	return cell(shown, width)
}

function isGo(providerID: string): boolean {
	return providerID === "opencode-go"
}

function free(row: Row): boolean {
	return row.input === 0 && row.output === 0
}

function headerRow(f: Fit): string {
	return [
		"  ",
		"    ",
		"model".padEnd(f.name),
		cell("in", 6),
		cell("out", 6),
		...(f.ctx ? [cell("ctx", 5)] : []),
		...(f.int ? [cell("int", 5)] : []),
		...(f.tkps ? [cell("tok/s", 6)] : []),
		cell("cred", 4),
		...(f.note ? [cell("note", 6)] : []),
	].join(" ")
}

function modelRow(row: Row, mine: boolean, favourite: boolean, f: Fit): string {
	const notes = [row.peak ? "peak*" + row.peak : "", row.promo ? "+" + row.promo + "x" : ""].filter(Boolean)
	return [
		(mine ? "●" : " ") + (favourite ? "*" : " "),
		tag(row.providerID),
		label(row.name, f.name),
		price(row.input, 6),
		price(row.output, 6),
		...(f.ctx ? [cell(tokens(row.context), 5)] : []),
		...(f.int ? [cell(row.int !== undefined ? row.int.toFixed(1) : "", 5)] : []),
		...(f.tkps ? [cell(row.tps !== undefined ? "~" + Math.round(row.tps) : "", 6)] : []),
		// Any credit other than 1 changes the effective price, so any of them is shown.
		cell(row.credit !== 1 ? "×" + row.credit : "", 4),
		...(f.note ? [cell(notes.join(" "), 6)] : []),
	].join(" ")
}

const TRACE = join(tmpdir(), "oc-models-pro.log")

function trace(message: string): void {
	try {
		appendFileSync(TRACE, new Date().toISOString() + " " + message + "\n")
	} catch {}
}

export default Plugin.define({
	id: "oc-models-pro",
	setup(context: any) {
		const ui = context.ui
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}
		const BASE = themeColour(["text", "base"])
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
		const ACCENT = themeColour(["syntax", "function"], ["syntax", "variable"]) ?? FALLBACK_ACCENT
		// Theme colours reach us as RGBA objects; `fg` takes them, a box background does not — it wants
		// a string, so the two surfaces are converted to hex.
		const hex = (node: any): string | undefined => {
			if (typeof node === "string") return node
			const buffer = node?.buffer
			if (!buffer) return undefined
			const channels = [0, 1, 2].map((index) =>
				Math.max(0, Math.min(255, Number(buffer[index]) || 0))
					.toString(16)
					.padStart(2, "0"),
			)
			return "#" + channels.join("")
		}
		const SURFACE = hex(themeColour(["surface", "base"], ["background", "raised", "base"]))
		// The cyan the native controls use when focused; the row text flips to the page colour on top.
		const SELECTED = hex(
			themeColour(["background", "action", "primary", "focused"], ["surface", "high"]),
		)
		const ON_SELECTED = hex(themeColour(["background", "base"], ["text", "base"]))
		const BORDER = hex(themeColour(["border", "base"], ["text", "faint"]))

		trace("setup: context=" + Object.keys(context).join(","))

		prefs = readPrefs()

		let creditIndex = new Map<string, Credits>()
		let bench = new Map<string, Bench>()
		/** False when the Go page could not be read and no cache was there: the credits are all 1. */
		let creditsKnown = false
		// Signals, not plain variables: the header shows them, and a plain variable left the title
		// saying "effective price" whatever the list was actually sorted by.
		const [sort, setSort] = createSignal(0)
		const [grouped, setGrouped] = createSignal(true)
		const [scope, setScope] = createSignal<Scope>("all")

		function fail(label: string, error: unknown): void {
			trace(
				label +
					": " +
					(error instanceof Error
						? error.message + " @ " + (error.stack ?? "").split("\n")[1]
						: String(error)),
			)
		}

		function locationRef(): any {
			return context.location ?? context.data.location.default()
		}

		/** The collections live under `data.location`; per location, and empty until synced once. */
		function listModels(): any[] {
			try {
				return context.data.location.model.list(locationRef()) ?? []
			} catch (error) {
				fail("models", error)
				return []
			}
		}

		function listProviders(): any[] {
			try {
				return context.data.location.provider.list(locationRef()) ?? []
			} catch (error) {
				fail("providers", error)
				return []
			}
		}

		function rows(): Row[] {
			const providers = new Map<string, string>(
				listProviders().map((provider: any) => [provider.id, provider.name]),
			)
			const result: Row[] = []
			for (const model of listModels()) {
				const cost = (model.cost ?? []).find((entry: any) => !entry.tier) ?? model.cost?.[0]
				const limit = model.limit ?? {}
				const score = benchFor(bench, model.name, model.modelID)
				result.push({
					name: model.name,
					providerID: model.providerID,
					modelID: model.modelID,
					// The host names an account-bound provider `<account> / <Provider>`, which in a group
					// header reads as if the account were the thing: provider first, account in brackets.
					provider: (providers.get(model.providerID) ?? model.providerID).replace(/^(.+?) \/ (.+)$/, "$2 ($1)"),
					// A missing figure stays missing: a 0 here would put an unknown model at the top of the
					// cheapest list and claim a context window it never declared.
					input: typeof cost?.input === "number" ? cost.input : undefined,
					output: typeof cost?.output === "number" ? cost.output : undefined,
					context: typeof limit.context === "number" ? limit.context : undefined,
					// The page describes the Go plan only, and its names are not the catalogue's: match the
					// model id, and only on the provider the plan applies to. By name alone, OpenRouter's
					// "DeepSeek V4.1 Flash" inherited the Go credit.
					credit: isGo(model.providerID) ? (creditIndex.get(key(model.modelID))?.credit ?? 1) : 1,
					promo: isGo(model.providerID) ? creditIndex.get(key(model.modelID))?.promo : undefined,
					peak: isGo(model.providerID) ? creditIndex.get(key(model.modelID))?.peak : undefined,
					int: score?.int,
					tps: score?.tps,
					enabled: model.enabled !== false,
				})
			}
			// Every provider keeps its row: the same model on `deepseek` and on `opencode-go` is two
			// different offers, and hiding one hid `deepseek-v4-pro` from the provider that hosts it.
			return result
		}

		async function warm(): Promise<void> {
			const ref = locationRef()
			try {
				if (listModels().length === 0) await context.data.location.model.sync(ref)
				if (listProviders().length === 0) await context.data.location.provider.sync(ref)
				trace("warm: models=" + listModels().length + " providers=" + listProviders().length)
			} catch (error) {
				fail("warm", error)
			}
		}

		async function open(): Promise<void> {
			prefs = readPrefs()
			await warm()
			// One fetch a day at most; a failure only costs the credit column and the effective ordering.
			const plan = await goPlan()
			creditIndex = plan ? credits(plan) : new Map()
			bench = await benchIndex()
			creditsKnown = creditIndex.size > 0
			trace(
				"open: models=" +
					listModels().length +
					" bench=" +
					bench.size +
					" plan=" +
					(plan ? "$" + plan.price + " " + plan.limits.length + " rows" : "none") +
					" credits=" +
					creditIndex.size +
					" prefs=" +
					prefs.favorite.size +
					"/" +
					prefs.recent.size,
			)
			if (!ui.panel.open("oc-models-pro")) {
				ui.toast.show({ message: "open a session first", variant: "warning" })
				return
			}
			trace("open: panel requested")
		}

		const Panel = (props: { panel: any }) => {
			const [selected, setSelected] = createSignal<string | undefined>(undefined)
			/** The panel's width, in columns, and the layout it buys — reactive: the host resizes it. */
			const width = createMemo(() => Math.floor(Number(props.panel.width) || 0), undefined, { equals: Object.is })
			// The scrollbox draws its scrollbar in the last column, so the table gets one less.
			// Both layouts carry an equality check: the width settles from pixels to columns on open,
			// and a memo that fires on that tick re-renders the panel for no visual change — which is
			// what took the focus off the search field.
			const fitted = createMemo(() => fit(width() - 1), undefined, {
				equals: (a: Fit, b: Fit) =>
					a.name === b.name && a.tkps === b.tkps && a.note === b.note && a.ctx === b.ctx && a.int === b.int,
			})
			const hints = createMemo(() => hintLines(width()), undefined, {
				equals: (a: string[], b: string[]) => a.join("\n") === b.join("\n"),
			})
			/** The legend shortens when the panel cannot hold the long one. */
			const compactLegend = createMemo(() => width() < LEGEND_MIN, undefined, { equals: Object.is })
			// Hover moves the selection, like the native lists; during a wheel scroll the host fires
			// over-events on whatever row lands under the pointer, so they are ignored until it stops.
			let lastScroll = 0
			const hover = (key: string): void => {
				if (Date.now() - lastScroll < 150) return
				if (selectedKey() !== key) setSelected(key)
			}
			const [query, setQuery] = createSignal("")
			// The app's state file can change under us (a toggle here, a model switched by the host);
			// bumping this is what re-reads it and re-renders the rows.
			const [revision, setRevision] = createSignal(0)
			// The input keeps its own text and cursor; clearing means clearing it too.
			let field: any
			/** Diagnostic: more than one mount per open means the panel is being rebuilt under us. */
			let inputMounts = 0
			/** Whether the field holds the focus — the host resets it on some reflows. */
			let focused = false
			const clear = (): void => {
				setQuery("")
				if (field && !field.isDestroyed) field.value = ""
			}
			
			// The host activates a panel's keyboard layers only while it owns input, and it disposes them
			// when the panel unmounts: measured three openings in a row, every one reading 10 reachable
			// `models-pro.*` commands and never 20 — a leaked layer would show up here first.
			try {
				trace(
					"panel: " +
						context.keymap.commands().filter((entry: any) => String(entry.id ?? "").startsWith("models-pro."))
							.length +
						" models-pro commands reachable",
				)
			} catch (error) {
				fail("panel commands", error)
			}

			// The state file is shared: the native picker and `model.cycle_favorite` write it while this
			// panel is open. Watching the directory (not the file) survives the rename, and every event
			// re-reads the file so the star and the `favorites` scope stay true.
			try {
				const watcher = watch(join(homedir(), ".local/state/opencode"), (_event, name) => {
					if (String(name) !== "model.json") return
					prefs = readPrefs()
					setRevision(revision() + 1)
				})
				onCleanup(() => watcher.close())
			} catch (error) {
				fail("watch prefs", error)
			}

			const mineKey = createMemo<string | undefined>(() => {
				const mine = ui.model.current()
				return mine ? prefKey(mine.providerID, mine.modelID) : undefined
			})

			/** Built only when the filter, the scope or a toggle changes — never on a selection move. */
			const itemList = createMemo<Item[]>(() => {
				revision()
				const mine = mineKey()
				const needle = query().trim().toLowerCase()
				let list = rows().filter((row) => row.enabled)
				if (scope() === "favorites")
					list = list.filter(
						(row) => prefs.favorite.has(prefKey(row.providerID, row.modelID)) || prefKey(row.providerID, row.modelID) === mine,
					)
				if (scope() === "paying") list = list.filter((row) => !free(row) || prefKey(row.providerID, row.modelID) === mine)
				if (needle)
					list = list.filter((row) =>
						(row.name + " " + row.provider + " " + row.providerID).toLowerCase().includes(needle),
					)

				list = [...list].sort((a, b) => {
					const mineA = prefKey(a.providerID, a.modelID) === mine
					const mineB = prefKey(b.providerID, b.modelID) === mine
					if (mineA !== mineB) return mineA ? -1 : 1
					if (SORTS[sort()].label !== "name") {
						const delta = SORTS[sort()].value(a) - SORTS[sort()].value(b)
						if (delta) return delta
					}
					return a.name.localeCompare(b.name)
				})

				// Free models never enter the price order: they are not cheap, they are unmetered, and at
				// the top they hide everything that costs something. Grouped, each one still sits under
				// its own provider, after that provider's paying rows — the group answers "who serves
				// this", and a global "Free" bucket would answer it wrong. Flat, they keep one bucket.
				const items: Item[] = []
				if (grouped()) {
					const groups = new Map<string, Row[]>()
					for (const row of list) {
						const bucket = groups.get(row.provider) ?? []
						bucket.push(row)
						groups.set(row.provider, bucket)
					}
					// Two bits: the model in use first, then the active order inside each of the two classes.
					// It leads its group even when it is free — it is the state of the session, not a price.
					for (const bucket of groups.values())
						bucket.sort((a, b) => {
							const mineA = prefKey(a.providerID, a.modelID) === mine
							const mineB = prefKey(b.providerID, b.modelID) === mine
							if (mineA !== mineB) return mineA ? -1 : 1
							return Number(free(a)) - Number(free(b))
						})
					const names = [...groups.keys()].sort((a, b) => a.localeCompare(b))
					// The provider of the model in use comes first, like the native picker.
					const mineProvider = list.find((row) => prefKey(row.providerID, row.modelID) === mine)?.provider
					if (mineProvider) names.sort((a, b) => (a === mineProvider ? -1 : b === mineProvider ? 1 : 0))
					for (const name of names) {
						items.push({ header: name })
						for (const row of groups.get(name)!) items.push({ row })
					}
				} else {
					// The model in use leads the list, free or not: it is the state of the session, not a
					// price to compare. The other free models keep the bucket at the end.
					for (const row of list)
						if (!free(row) || prefKey(row.providerID, row.modelID) === mine) items.push({ row })
					const freeRows = list.filter((row) => free(row) && prefKey(row.providerID, row.modelID) !== mine)
					if (freeRows.length) {
						items.push({ header: "Free" })
						for (const row of freeRows) items.push({ row })
					}
				}
				return items
			})

			const selectable = createMemo<Row[]>(() => itemList().flatMap((item) => (item.row ? [item.row] : [])))

			/** Derived: the stored key if it still exists, else the model in use, else the first row. */
			const selectedKey = createMemo<string | undefined>(() => {
				const list = selectable()
				const stored = selected()
				if (stored && list.some((row) => prefKey(row.providerID, row.modelID) === stored)) return stored
				const mine = mineKey()
				if (mine && list.some((row) => prefKey(row.providerID, row.modelID) === mine)) return mine
				const first = list[0]
				return first ? prefKey(first.providerID, first.modelID) : undefined
			})

			function move(delta: number): void {
				const list = selectable()
				if (list.length === 0) return
				const at = list.findIndex((row) => prefKey(row.providerID, row.modelID) === selectedKey())
				const next = Math.min(list.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta))
				const key = prefKey(list[next].providerID, list[next].modelID)
				setSelected(key)
				reveal(key)
			}

			/** The list is taller than the panel: the selection has to drag the viewport with it. */
			let scroller: any
			function reveal(key: string): void {
				const box = scroller
				if (!box || box.isDestroyed) return
				try {
					box.scrollChildIntoView("mp-" + key)
				} catch (error) {
					fail("scroll", error)
				}
			}

			function choose(target?: Row): void {
				const wanted = selectedKey()
				const row =
					target ??
					selectable().find((entry) => prefKey(entry.providerID, entry.modelID) === wanted)
				if (!row) return
				trace("choose: " + prefKey(row.providerID, row.modelID))
				props.panel.close()
				void (async () => {
					if (!(await selectModel(row))) {
						// The native never fails here — it writes the selection itself — so this is the one
						// thing it has no equivalent for. A failure nobody announced is worse.
						const now = ui.model.current()
						ui.toast.show({
							message:
								row.name +
								" was not applied — the session kept " +
								(now ? now.providerID + "/" + now.modelID : "the previous model"),
							variant: "error",
						})
						return
					}
					await settleVariant(row)
				})()
			}

			/**
			 * The host owns the model selection: the native picker writes it with the host's own
			 * `model.set`, per session and agent, and the prompt sends it to the server. The plugin API
			 * has no setter for it — `ui.model` reads it and changes its variant, nothing more — so the
			 * host makes the change: `model.cycle_favorite` ends on the first favourite, the same
			 * internal call the picker makes. The list is prepared for that call and put back right
			 * after. One entry is what makes the call safe to repeat: whatever is selected, it lands on
			 * that entry.
			 */
			async function selectModel(row: Row): Promise<boolean> {
				// The upstream fix, when it lands: the host's setter, and no list at all.
				const native = ui.model.set
				if (typeof native === "function") {
					native.call(ui.model, { providerID: row.providerID, modelID: row.modelID })
					const now = ui.model.current()
					return now?.providerID === row.providerID && now?.modelID === row.modelID
				}
				const list = readFavourites()
				if (!list) return false
				if (!writeFavourites([{ providerID: row.providerID, modelID: row.modelID }])) return false
				// The host watches the file: it needs a moment before the command reads the list.
				await new Promise((resolve) => setTimeout(resolve, 100))
				let landed = false
				for (let attempt = 0; attempt < 20 && !landed; attempt++) {
					// A second call covers the moment the host had not read the file yet.
					if (attempt % 4 === 0) {
						try {
							context.keymap.dispatch("model.cycle_favorite")
						} catch (error) {
							fail("dispatch", error)
							break
						}
					}
					const now = ui.model.current()
					landed = now?.providerID === row.providerID && now?.modelID === row.modelID
					if (!landed) await new Promise((resolve) => setTimeout(resolve, 50))
				}
				writeFavourites(list)
				trace("select: " + row.name + (landed ? " landed" : " did not land"))
				return landed
			}

			/**
			 * A model whose variant was never chosen has none applied, and the native picker asks once for
			 * it. Same rule here: a saved entry — `default` included — means silence; no entry opens the
			 * question, and the host's own `variant.set` is what persists the answer.
			 */
			async function settleVariant(row: Row): Promise<void> {
				// The file is the source, not the copy read at open: a variant saved meanwhile (native
				// picker, prompt) has to count as an answer.
				prefs = readPrefs()
				if (prefs.variants.has(prefKey(row.providerID, row.modelID))) return
				// `list()` and `set()` act on the selected model, which is now the new one: the question
				// is asked before anything could move it again.
				let variants: string[] = []
				try {
					variants = [...ui.model.variant.list()]
				} catch (error) {
					fail("variants", error)
					return
				}
				if (variants.length === 0) return
				trace("variants: " + variants.join(",") + " for " + row.name)
				const picks = ["default", ...variants]
				const chosen = (await ui.dialog.select({
					title: "Variant — " + row.name,
					placeholder: "filter variants",
					options: picks.map((id) => ({
						title: id === "default" ? "Default (no variant)" : id,
						value: id,
						description: "",
					})),
				})) as string | undefined
				// Cancelling leaves the model without a variant, and the question will come back, as in
				// the native picker.
				if (chosen === undefined) return
				const applied = ui.model.variant.set(chosen === "default" ? undefined : chosen)
				trace("variant set: " + chosen + " -> " + applied)
			}

			function cycleSort(): void {
				setSort((sort() + 1) % SORTS.length)
			}

			function recentSort(): void {
				setSort(SORTS.findIndex((entry) => entry.label === "recently used"))
			}

			function toggleGroups(): void {
				setGrouped(!grouped())
			}

			function cycleScope(): void {
				setScope(SCOPES[(SCOPES.indexOf(scope()) + 1) % SCOPES.length])
			}

			/** Writes the app's state file, then re-reads it: the row and the native picker agree. */
			function favourite(): void {
				const wanted = selectedKey()
				const row = selectable().find((entry) => prefKey(entry.providerID, entry.modelID) === wanted)
				if (!row) return
				const on = toggleFavorite(row.providerID, row.modelID)
				if (on === undefined) {
					ui.toast.show({ message: "could not write " + PREFS_FILE, variant: "error" })
					return
				}
				prefs = readPrefs()
				setRevision(revision() + 1)
				ui.toast.show({
					message: row.name + (on ? " added to" : " removed from") + " favourites",
					variant: on ? "success" : "info",
				})
			}

			context.keymap.layer(() => ({
				mode: "global",
				enabled: () => props.panel.focused,
				commands: [
					{ id: "models-pro.clear", title: "Clear the search", bind: "ctrl+u", run: () => clear() },
					{ id: "models-pro.up", title: "Previous model", bind: "up", run: () => move(-1) },
					{ id: "models-pro.down", title: "Next model", bind: "down", run: () => move(1) },
					{ id: "models-pro.choose", title: "Use the model", bind: "enter", run: () => choose() },
					{ id: "models-pro.sort", title: "Sort", bind: "ctrl+o", run: () => cycleSort() },
					{ id: "models-pro.groups", title: "Group by provider", bind: "ctrl+g", run: () => toggleGroups() },
					{ id: "models-pro.scope", title: "Scope", bind: "ctrl+s", run: () => cycleScope() },
					{ id: "models-pro.recent", title: "Recently used", bind: "ctrl+r", run: () => recentSort() },
					{ id: "models-pro.favorite", title: "Toggle favourite", bind: "ctrl+f", run: () => favourite() },
					{ id: "models-pro.close", title: "Clear the search, or close the list", bind: "esc", run: () => (query() ? clear() : props.panel.close()) },
					// `ctrl+y`: `f11` never reached the panel in the terminal. `ctrl+f` marks a favourite,
					// as in the native dialog. `f` alone stays unusable: it would be typed into the search.
					{ id: "models-pro.fullscreen", title: "Full screen", bind: "ctrl+y", run: () => props.panel.toggleFullscreen() },
				],
			}))

			trace("panel: mounted")

			// A reflow — the width settling from pixels, the footer taking a second line — can take the
			// focus off the search field. The panel still has it, so the field takes it back. This does
			// not depend on the memo equality guards being honoured by the host's renderer.
			createEffect(() => {
				fitted()
				hints()
				const element = field
				if (focused || !element || element.isDestroyed || !props.panel.focused) return
				element.focus()
			})

			// The table is hand-padded, so its width is measured on the real rows instead of trusted:
			// a mismatch against what the panel can hold shows up in the trace next to every open.
			try {
				const sample = selectable()[0]
				const f = fitted()
				trace(
					"panel widths: panel=" +
						width() +
						" header=" +
						headerRow(f).length +
						" row=" +
						(sample ? modelRow(sample, false, false, f).length : 0) +
						" fits=" +
						rowWidth(f) +
						" name=" +
						f.name +
						" cols=" +
						[f.tkps && "tok/s", f.note && "note", f.ctx && "ctx", f.int && "int"].filter(Boolean).join(",") +
						" rows=" +
						selectable().length,
				)
			} catch (error) {
				fail("panel widths", error)
			}

			return (
				<box flexDirection="column" flexGrow={1}>
					<box flexDirection="row" height={1} flexShrink={0}>
						<text fg={BASE} wrapMode="none">
							<b>Models</b>
						</text>
						<text fg={DIM} wrapMode="none">
							{"  "}
							{"sort: " + SORTS[sort()].short} ·
						</text>
						{/* The scope is the only filter that changes the list, so it is the only thing in
						    bold: the sort and the grouping are information, the scope is the lens. */}
						<text fg={BASE} wrapMode="none">
							<b>{scope()}</b>
						</text>
						<text fg={DIM} wrapMode="none">
							{" · " + (grouped() ? "grouped" : "flat") + (creditsKnown ? "" : " · credits n/a")}
						</text>
					</box>
					<box height={1} flexShrink={0}>
						<text fg={DIM} wrapMode="none">
							{compactLegend()
								? "×N credit · peak*2 · +4x promo"
								: "(×N = Go credit · peak*2 = the tariff doubles at peak · +Nx = promotion)"}
						</text>
					</box>
					<box
						height={3}
						flexShrink={0}
						border={["top", "bottom", "left", "right"]}
						borderColor={BORDER}
						paddingLeft={1}
						paddingRight={1}
					>
						<input
							ref={(element: any) => {
								field = element
								if (!element) return
								const mount = ++inputMounts
								trace("panel: input mounted #" + mount)
								// The native dialog's own recipe: tag it as the filter, then focus it a tick later.
								element.traits = { status: "FILTER" }
								setTimeout(() => {
									trace("panel: input focus #" + mount + " destroyed=" + element.isDestroyed)
									if (!element.isDestroyed) element.focus()
								}, 1)
							}}
							onFocus={() => (focused = true)}
							onBlur={() => (focused = false)}
							placeholder="Search (ctrl+u clear)"
							flexGrow={1}
							placeholderColor={themeColour(["text", "faint"])}
							focusedTextColor={themeColour(["text", "base"])}
							focusedBackgroundColor={themeColour(["background", "formfield", "focused"])}
							cursorColor={themeColour(["text", "formfield", "focused"])}
							onInput={(value: any) => setQuery(typeof value === "string" ? value : "")}
						/>
					</box>
					{/* The column headers sit directly on the rows: the search field between them would
					    break the pair and leave the figures unlabelled. */}
					<box height={1} flexShrink={0}>
						<text fg={DIM} wrapMode="none">
							{headerRow(fitted())}
						</text>
					</box>
					<scrollbox ref={(element: any) => (scroller = element)} flexGrow={1} flexShrink={1} onMouseScroll={() => (lastScroll = Date.now())}>
						<For each={itemList()}>
							{(item: Item) => {
								if (item.header)
									return (
										<text fg={DIM} wrapMode="none">
											{"── " + item.header + " " + "─".repeat(Math.max(0, 56 - item.header.length))}
										</text>
									)
								const row = item.row!
								const key = prefKey(row.providerID, row.modelID)
								const mine = () => key === mineKey()
								const active = () => key === selectedKey()
								// A favourite is marked everywhere but in the favourites scope, where every row is one.
								const favourite = () => {
									revision()
									return scope() !== "favorites" && prefs.favorite.has(key)
								}
								return (
									<box
										id={"mp-" + key}
										height={1}
										backgroundColor={active() ? SELECTED : undefined}
										onMouseOver={() => hover(key)}
										onMouseMove={() => hover(key)}
										onMouseDown={() => {
											setSelected(key)
											choose(row)
										}}
									>
										<text fg={active() ? ON_SELECTED : mine() ? ACCENT : BASE} wrapMode="none">
											{modelRow(row, mine(), favourite(), fitted())}
										</text>
									</box>
								)
							}}
						</For>
					</scrollbox>
					<box flexDirection="column" height={hints().length} flexShrink={0} backgroundColor={SURFACE}>
						<For each={hints()}>
							{(line: string) => (
								<box height={1}>
									<text fg={DIM} wrapMode="none">
										{line}
									</text>
								</box>
							)}
						</For>
					</box>
				</box>
			)
		}

		context.ui.slot({
			append: "session.panel",
			render: (panel: any) => (
				<Show when={panel.name === "oc-models-pro"}>
					<Panel panel={panel} />
				</Show>
			),
		})

		const command = {
			id: "models-pro",
			title: "Models with prices (pro)",
			description: "Pick a model by price, context or credit multiplier",
			slash: { name: "models-pro" },
			palette: true,
			bind: "<leader>p",
			run: () => {
				// The synchronous part of open() runs during the call, so it needs a plain try:
				// a rejected promise would never see it.
				try {
					void open().catch((error: unknown) => fail("open async", error))
				} catch (error) {
					fail("open sync", error)
				}
			},
		}
		// The types publish the keymap twice — `context.keymap` and `ui.keymap` — and this build answers
		// for one of them only. Try both, record which one took it, never fail silently.
		const keymaps: Array<[string, any]> = [
			["context.keymap", context.keymap],
			["ui.keymap", context.ui?.keymap],
		]
		let registered = false
		for (const [label, keymap] of keymaps) {
			if (!keymap || typeof keymap.layer !== "function") {
				trace(label + ": not a keymap (" + typeof keymap + ")")
				continue
			}
			try {
				keymap.layer(() => ({ mode: "global", commands: [command] }))
				trace("registered through " + label + "; bind=" + keymap.shortcuts("models-pro").join(","))
				registered = true
				break
			} catch (error) {
				trace(label + " failed: " + (error instanceof Error ? error.message : String(error)))
			}
		}
		if (!registered) trace("no keymap accepted the command; ui=" + (context.ui ? Object.keys(context.ui).join(",") : "none"))
	},
})
