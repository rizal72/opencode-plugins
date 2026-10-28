// oc-models-pro/prefs.ts — the picker's own state file, `~/.local/state/opencode/model.json`.
//
// Both halves need it: the terminal draws the list and toggles a favourite from the panel, the desktop
// writes the same file through its server half. It lives here so the recipe exists once — a second copy
// is a second way to lose `recent[]` or `variant{}`.
//
// The host watches this path and `model.json.*`. The write is `.model.json.tmp` then rename: the leading
// dot keeps the temp name outside that glob, so the host never sees half a file.
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The picker's state file. Exported for the message a failed write shows. */
export const PREFS_FILE = join(homedir(), ".local/state/opencode/model.json")
const TEMP_FILE = join(homedir(), ".local/state/opencode", ".model.json.tmp")

export const prefKey = (providerID: string, modelID: string): string => providerID + "/" + modelID

/** `favorite[]` and `recent[]` are `{ providerID, modelID }`. */
export interface Entry {
	providerID: string
	modelID: string
}

export interface Prefs {
	favorite: Set<string>
	recent: Map<string, number>
	/** `variant{ "provider/model": "high" }`: a saved variant per model, "default" included. */
	variants: Map<string, string>
}

/** The host's `favorite[]` as it is in the file: a key cannot be split back — a model id may hold a slash. */
export function readFavourites(): Entry[] | undefined {
	try {
		const data = JSON.parse(readFileSync(PREFS_FILE, "utf8"))
		if (!Array.isArray(data.favorite)) return []
		return data.favorite.filter(
			(entry: any) => typeof entry?.providerID === "string" && typeof entry?.modelID === "string",
		)
	} catch (error) {
		// A missing file is not an error: starting empty creates it on the write. Anything else is.
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return []
		console.error("[oc-models-pro] favourites: " + (error instanceof Error ? error.message : String(error)))
		return undefined
	}
}

/** Rewrites `favorite[]` with the rest of the file untouched. */
export function writeFavourites(list: Entry[]): boolean {
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
		console.error("[oc-models-pro] favourites: " + (error instanceof Error ? error.message : String(error)))
		return false
	}
}

/** Adds or removes one model; `undefined` when the file could not be read or written. */
export function toggleFavorite(providerID: string, modelID: string, on?: boolean): boolean | undefined {
	const key = prefKey(providerID, modelID)
	const list = readFavourites()
	if (!list) return undefined
	const kept = list.filter((entry) => prefKey(entry.providerID, entry.modelID) !== key)
	const next = on ?? kept.length === list.length
	return writeFavourites(next ? [...kept, { providerID, modelID }] : kept) ? next : undefined
}

export function readPrefs(): Prefs {
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
		console.error("[oc-models-pro] prefs unreadable: " + (error instanceof Error ? error.message : String(error)))
	}
	return parsed
}
