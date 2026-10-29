#!/usr/bin/env node
// Fails when a compiled `tui.js` sits beside its `tui.tsx` in this repository.
//
// The loader resolves a plugin directory by file name and does not read `package.json`, so a `tui.js`
// beside the source wins and the local TUI half runs that build — frozen, silently, however often the
// `.tsx` is edited afterwards. `git status` cannot catch it: `plugins/*/tui.js` is ignored, which is how
// four plugins stayed stale through a whole evening of edits (2026-10-27). Hence a check, not a rule.
import { execSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const plugins = join(root, "plugins")
const found = readdirSync(plugins, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.filter((name) => existsSync(join(plugins, name, "tui.js")))

if (found.length) {
	console.error("a tui.js shadows its tui.tsx — nothing would load the source:")
	for (const name of found) console.error("  plugins/" + name + "/tui.js")
	console.error("delete it: the compiled half belongs to the published package (`scripts/build-tui.mjs --out <dir>`)")
	process.exit(1)
}
console.log("check-source ok: no tui.js beside a tui.tsx")

// Fails when a GUI half imports the raw `createEffect`. A half synchronises through `createKeyed` from
// `@opencode/plugin/gui`: the SDK follows the plugin's lifetime and its dependencies' restarts, and a
// hand-written effect does not know when to die — plugin reload, server restart, window closed
// (`docs/gui-plugins.md`). The list below is the debt: the halves that predate the rule. A name leaves it
// as its file migrates, and once it is empty the check polices every half. Limit: it watches the import,
// so a new `createEffect` inside a listed file is not caught.
const legacy = new Set(["oc-budget", "oc-coffee", "oc-git", "oc-models-pro", "oc-ponytail-widget"])
const halves = readdirSync(plugins, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.filter((name) => existsSync(join(plugins, name, "gui.tsx")))
const importsEffect = (name) => {
	const source = readFileSync(join(plugins, name, "gui.tsx"), "utf8")
	const imports = source.matchAll(/import\s+((?:(?!\bfrom\b)[\s\S])*?)\s+from\s*["']solid-js["']/g)
	return [...imports].some((match) => /\bcreateEffect\b/.test(match[1]))
}
const plain = halves.filter((name) => !legacy.has(name) && importsEffect(name))
const stale = [...legacy].filter((name) => halves.includes(name) && !importsEffect(name))

if (plain.length || stale.length) {
	if (plain.length) {
		console.error("a GUI half imports createEffect from solid-js — use createKeyed from @opencode/plugin/gui:")
		for (const name of plain) console.error("  plugins/" + name + "/gui.tsx")
		console.error("the SDK follows the plugin's lifetime; the rule and the tolerated sites are in docs/gui-plugins.md")
	}
	if (stale.length) {
		console.error("these no longer import createEffect — drop them from the allow-list in this check:")
		for (const name of stale) console.error("  " + name)
	}
	process.exit(1)
}
// A listed half whose package moved is the moment to migrate it, not a failure: a note, silent on every
// other commit, and it dies with the list.
try {
	const moved = new Set(
		execSync(`git -C "${root}" status --porcelain`, { encoding: "utf8" })
			.split("\n")
			.map((line) => line.slice(3).split("/")[1]),
	)
	for (const name of legacy)
		if (moved.has(name))
			console.error(
				`note: plugins/${name} moved, and its GUI half still imports createEffect — migrate it to createKeyed or the list carries it further`,
			)
} catch {}

console.log(
	legacy.size
		? `check-source ok: no unlisted createEffect (${legacy.size} legacy GUI halves listed)`
		: "check-source ok: no createEffect in a GUI half",
)
