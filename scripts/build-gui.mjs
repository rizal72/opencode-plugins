#!/usr/bin/env node
// Builds each GUI half to the one CommonJS bundle OpenCode Desktop evaluates as text: a `.tsx` or an ES
// module is never a GUI entry, so the bundle is what ships and what the app reads from the working copy.
// Source of the reasoning: docs/gui-plugins.md.
//
//   node scripts/build-gui.mjs [plugin...]     # default: every plugin with a vite.config.ts
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const asked = process.argv.slice(2)
const names = asked.length
	? asked
	: readdirSync(join(root, "plugins"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => existsSync(join(root, "plugins", name, "vite.config.ts")))

for (const name of names) {
	const cwd = join(root, "plugins", name)
	execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
		cwd,
		stdio: "inherit",
	})
	if (!existsSync(join(cwd, "dist", "gui-experimental.cjs")))
		throw new Error(name + ": the build wrote no dist/gui-experimental.cjs")
	console.log(name + ": dist/gui-experimental.cjs written")
}
