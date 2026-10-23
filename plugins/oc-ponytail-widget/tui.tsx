// oc-ponytail-widget — TUI half.
//
// The badge pi has and OpenCode was missing: the ponytail level in the prompt footer, to the right of
// the coffee cup — 󱗁 full. The **glyph** is green while a run is active and grey when idle, exactly
// like the cup; the **level word** stays dim and carries the state. The badge is **always visible,
// `off` included**: seeing `off` is how you know the plugin is loaded and deliberately doing nothing —
// the rule the cup follows, and a deliberate deviation from pi, which hides it.
// (pi's own extension publishes this as a status key, drawn by pi's footer; the OpenCode half of the
// package is **server-only** — no TUI part at all, verified 2026-10-17 — so this is ours.)
//
// md-horse_variant (U+F15C1). Nerd Fonts has **no** ponytail glyph (checked against its own
// `glyphnames.json`: nothing for pony/tail/hair/mane/braid), and the `fa-*` horses live at
// U+E000–U+F8FF, a range the owner's font does not cover in every rendering path — the `md-*` range
// (plane 15) it does.
//
// The level is read from the **same sources the package reads** (`hooks/ponytail-config.js`), in the
// same order: the state file the OpenCode plugin writes on `/ponytail <level>`, then the shared config
// (`~/.config/ponytail/config.json` — the one file pi and OpenCode both read), then the package's own
// hardcoded `full`. Nothing of ours is written: a badge that could contradict the ruleset actually in
// the prompt would be worse than no badge.
//
// shortcut: the state file is re-read when a run **starts**, not the moment it is written — a level set
// with `/ponytail lite` appears on the turn that command triggers, not before. Upgrade path: watch the
// file (`fs.watch`) instead of riding the run events.
import { Plugin } from "@opencode/plugin/tui"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createRoot, createSignal } from "solid-js"

/** md-horse_variant (U+F15C1) — a horse, because the ponytail glyph does not exist. */
const GLYPH = "\u{f15c1}"

/** The package's runtime levels. `review` is session-only and can never be a persisted level. */
const LEVELS = ["off", "lite", "full", "ultra"]

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_DIM = "#8b949e"

/** Where the package looks for its own files, `$XDG_CONFIG_HOME` first — same rule. */
const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")

function normalized(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined
	const candidate = value.trim().toLowerCase()
	return LEVELS.includes(candidate) ? candidate : undefined
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return undefined
	}
}

/** `~/.config/ponytail/config.json`, the file pi and OpenCode share. */
function configuredDefault(): string | undefined {
	const raw = readText(join(CONFIG_DIR, "ponytail", "config.json"))
	if (!raw) return undefined
	try {
		return normalized(JSON.parse(raw)?.defaultMode)
	} catch {
		return undefined
	}
}

/** The level in force: the state file the plugin writes, else the shared default — `undefined` when
 *  neither exists, which is how an install without ponytail is told apart from one at its own default.
 *  shortcut: `PONYTAIL_DEFAULT_MODE` is deliberately not consulted — the package documents it as the
 *  variable to avoid (it outranks the config). Add it ahead of the config if that ever changes. */
function currentLevel(): string | undefined {
	const state = normalized(readText(join(CONFIG_DIR, "opencode", ".ponytail-active")))
	return state ?? configuredDefault()
}

export default Plugin.define({
	id: "oc-ponytail-widget.tui",
	setup(context: any) {
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}
		const GREEN =
			themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ??
			FALLBACK_GREEN
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM

		/** Runs in flight: several sessions can execute at once, so it is a count, not a flag. */
		let running = 0
		/** Reactive, or the render would read the signal once and never repaint. */
		const [active, setActive] = createRoot(() => createSignal(false))
		/** Bumped when a run starts: the level lives in a file, and a new turn is the one moment it
		 *  can have changed since we last looked. */
		const [seen, setSeen] = createRoot(() => createSignal(0))

		const level = createMemo(() => {
			seen()
			return currentLevel()
		})

		const stopStarted = context.data.on("session.execution.started", () => {
			running += 1
			setSeen((count: number) => count + 1)
			if (running === 1) setActive(true)
		})
		const settle = () => {
			running = Math.max(0, running - 1)
			if (running === 0) setActive(false)
		}
		const stopSucceeded = context.data.on("session.execution.succeeded", settle)
		const stopFailed = context.data.on("session.execution.failed", settle)
		const stopInterrupted = context.data.on("session.execution.interrupted", settle)

		/** Always visible, `off` included, once ponytail has a level to show: the badge is the setting,
		 *  and seeing `off` is how you know the plugin is loaded and deliberately doing nothing. (pi
		 *  hides it; the owner chose the cup's rule for both badges instead.) With no level file and no
		 *  shared config there is no ponytail to report on, and a fallback `full` would be a claim
		 *  about a plugin that is not installed — so nothing is drawn. */
		const Badge = () => {
			const value = level()
			if (!value) return null
			return (
				<box flexDirection="row" flexShrink={0}>
					<text fg={active() ? GREEN : DIM} wrapMode="none">{GLYPH}</text>
					<text fg={DIM} wrapMode="none"> {value}</text>
				</box>
			)
		}

		context.ui.slot({ append: "prompt.footer.status", render: () => <Badge /> })

		return () => {
			stopStarted?.()
			stopSucceeded?.()
			stopFailed?.()
			stopInterrupted?.()
		}
	},
})
