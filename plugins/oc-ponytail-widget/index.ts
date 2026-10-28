// oc-ponytail-widget — server half.
//
// The level is not ours: it is the ponytail package's, and it lives in `~/.config/ponytail/config.json`
// (`defaultMode`), the one file pi and OpenCode both read. The terminal's badge and the desktop's pill
// both read through here, so the two surfaces cannot disagree.
//
// Sources, in the order the package reads them: the state file `/ponytail <level>` writes, then the
// shared config, then nothing — where `full` is the level the package itself would apply.
//
// "Would apply" needs one more fact: is the package there at all? A level set on a machine without
// ponytail installed describes nothing, so the host's own plugin registry is asked, and with no
// ponytail the surfaces draw nothing (`docs/oc-ponytail-widget.md`).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Ponytail, isLevel, type Level, type State } from "./rpc.ts"

/** Where the package looks for its own files, `$XDG_CONFIG_HOME` first — the same rule it uses. */
const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const STATE = join(CONFIG_DIR, "opencode", ".ponytail-active")
const CONFIG = join(CONFIG_DIR, "ponytail", "config.json")

/** The package as npm names it, and the folder name a `local` install would have. */
const PACKAGE = "@dietrichgebert/ponytail"
const NAME = "ponytail"
/** The registry is asked at most this often: it changes on a config save, not on a clock tick. */
const ALIVE_MS = 60_000

const read = async (path: string): Promise<string | undefined> => {
	try {
		return await readFile(path, "utf8")
	} catch {
		return undefined
	}
}

const normalized = (value: unknown): Level | undefined => {
	if (typeof value !== "string") return undefined
	const candidate = value.trim().toLowerCase()
	return isLevel(candidate) ? candidate : undefined
}

async function configured(): Promise<Level | undefined> {
	const raw = await read(CONFIG)
	if (!raw) return undefined
	try {
		return normalized(JSON.parse(raw)?.defaultMode)
	} catch {
		return undefined
	}
}

/** A package entry, or a `local` folder named after it: both mean the same thing here. */
const isPonytail = (entry: any): boolean => {
	const source = entry?.source
	if (entry?.id === NAME) return true
	if (source?.type === "package") return source.target === PACKAGE || source.target?.endsWith(`/${NAME}`)
	if (source?.type === "local") return String(source.path ?? "").split(/[\\/]/).pop() === NAME
	return false
}

export default {
	id: "oc-ponytail-widget",
	async setup(ctx: any) {
		/** True until the registry says otherwise: a failed call must not hide a level that is in force. */
		let installed = true
		let asked = 0

		async function alive(): Promise<boolean> {
			if (Date.now() - asked < ALIVE_MS) return installed
			// Set before the await, so a failing call also waits its turn instead of retrying on every poll.
			asked = Date.now()
			try {
				const { data } = await ctx.plugin.list()
				installed = data.some((entry: any) => isPonytail(entry) && entry?.state?.status === "active")
			} catch {
				// A registry that cannot answer says nothing about the package: the last answer stands.
			}
			return installed
		}

		async function state(): Promise<State> {
			const observed = await alive()
			const fromState = normalized(await read(STATE))
			if (fromState) return { level: fromState, source: "state", installed: observed }
			const fromConfig = await configured()
			if (fromConfig) return { level: fromConfig, source: "config", installed: observed }
			return { level: "full", source: "none", installed: observed }
		}

		/**
		 * Writes the OpenCode state file the package's plugin writes on `/ponytail <level>`: plain text, the
		 * word alone, no trailing newline. That file is read before the shared config, so the pill outranks
		 * the default without editing a file pi also reads.
		 */
		async function set(level: Level): Promise<State> {
			await mkdir(dirname(STATE), { recursive: true })
			// A scratch name per process: two `set`s at once must not rename each other's half-written bytes.
			const scratch = `${STATE}.${process.pid}.tmp`
			await writeFile(scratch, level)
			await rename(scratch, STATE)
			return state()
		}

		await ctx.rpc.register(Ponytail, {
			state,
			set: async (input: any) => {
				if (!isLevel(input?.level)) throw new Error(`unknown ponytail level: ${String(input?.level)}`)
				return set(input.level)
			},
		})
	},
}
