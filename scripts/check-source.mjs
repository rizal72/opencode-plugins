#!/usr/bin/env node
// Fails when a compiled `tui.js` sits beside its `tui.tsx` in this repository.
//
// The loader resolves a plugin directory by file name and does not read `package.json`, so a `tui.js`
// beside the source wins and the local TUI half runs that build — frozen, silently, however often the
// `.tsx` is edited afterwards. `git status` cannot catch it: `plugins/*/tui.js` is ignored, which is how
// four plugins stayed stale through a whole evening of edits (2026-10-27). Hence a check, not a rule.
import { existsSync, readdirSync } from "node:fs"
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
	console.error("delete it: the compiled half belongs to the mirror (`scripts/build-tui.mjs --out <dir>`)")
	process.exit(1)
}
console.log("check-source ok: no tui.js beside a tui.tsx")
