#!/usr/bin/env node
// Compiles each TUI half to plain JS, because OpenCode's Solid JSX transform skips `node_modules`:
// a `.tsx` shipped to npm is compiled with React's runtime instead and fails on `import "react"`.
// Source of the reasoning: docs/publishing.md.
//
//   node scripts/build-tui.mjs --out <dir> [plugin...]   # writes <dir>/<plugin>/tui.js
//
// `--out` is mandatory and is never this repository: a `tui.js` beside a `tui.tsx` shadows it, because
// the loader resolves a directory by file name and does not read `package.json` — so compiling here
// silently freezes the TUI half at the moment of the build (measured 2026-10-27, four plugins stuck).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { transformSync } from "@babel/core"
import presetSolid from "babel-preset-solid"
import presetTypeScript from "@babel/preset-typescript"

const root = new URL("..", import.meta.url).pathname
const args = process.argv.slice(2)
const at = args.indexOf("--out")
if (at < 0 || !args[at + 1]) {
	console.error("build-tui: --out <dir> is required; this repository is never the destination")
	process.exit(2)
}
const out = args[at + 1]
const asked = args.filter((arg, index) => index !== at && index !== at + 1)
const names = asked.length
	? asked
	: readdirSync(join(root, "plugins"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => existsSync(join(root, "plugins", name, "tui.tsx")))
			// Only the packages that publish the compiled half: a local plugin needs no `tui.js` at all.
			.filter((name) => {
				const manifest = JSON.parse(readFileSync(join(root, "plugins", name, "package.json"), "utf8"))
				return String(manifest.name ?? "").startsWith("@rizal72/")
			})

for (const name of names) {
	const file = join(root, "plugins", name, "tui.tsx")
	if (!existsSync(file)) throw new Error("no tui.tsx in " + name)
	const code = readFileSync(file, "utf8")
	const result = transformSync(code, {
		filename: file,
		babelrc: false,
		configFile: false,
		presets: [
			// `moduleName` is what the host itself uses: the imports then resolve to its runtime.
			[presetSolid, { moduleName: "@opentui/solid", generate: "universal" }],
			[presetTypeScript, { isTSX: true, allExtensions: true, onlyRemoveTypeImports: true }],
		],
	})
	mkdirSync(join(out, name), { recursive: true })
	writeFileSync(join(out, name, "tui.js"), result.code + "\n")
	// A transform that leaves JSX behind would put `react` back in the package; fail here, not on a user's machine.
	if (/\b_?jsx\w*\(/.test(result.code)) throw new Error(name + ": JSX left in the compiled output")
	console.log(name + ": tui.js written to " + out)
}
