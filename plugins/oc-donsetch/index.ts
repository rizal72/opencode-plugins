// oc-donsetch — keeps the binary of the hostile-fetch tool current.
//
// The MCP server itself is registered in `~/.config/opencode/opencode.jsonc`, off by default like the
// ArtCraft ones: a config entry is the only place that carries the on/off switch, and a server that is
// always connected costs prompt tokens in every session.
//
// What the plugin still carries is the updater. `donsetch update` has no daemon and no config knob, so
// something has to run it. Not the service start — that happens once a month on this machine — and not
// every prompt, which would mean a network check per message. Once a day, on the first prompt after the
// date changes: the check happens while the tool is about to be used, and never on an idle clock.
//
// The binary itself is NOT installed here: `npm i -g donsetch` stays the one-time step.
import { Plugin } from "@opencode/plugin"
import { spawn, execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const STAMP = join(homedir(), ".cache", "oc-donsetch", "last-check")

/** `DONSETCH_BINARY` wins; otherwise the binary on PATH, which is where `npm i -g` puts it. */
function resolveBinary(): string | undefined {
	const candidates = [process.env.DONSETCH_BINARY, "donsetch"].filter((value): value is string => !!value)
	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 5000 })
			return candidate
		} catch {}
	}
	return undefined
}

/** Fire and forget, once a day: a failed check only means the binary stays a day behind. */
async function checkUpdate(binary: string): Promise<void> {
	// Local calendar date, `YYYY-MM-DD`; en-CA is the one locale that prints it in that order.
	const today = new Date().toLocaleDateString("en-CA")
	try {
		if ((await readFile(STAMP, "utf8")).trim() === today) return
	} catch {}
	try {
		await mkdir(dirname(STAMP), { recursive: true })
		await writeFile(STAMP, today)
		spawn(binary, ["update"], { detached: true, stdio: "ignore" }).unref()
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`[oc-donsetch] could not start the update check: ${message}`)
	}
}

export default Plugin.define({
	id: "oc-donsetch",
	async setup(context: any) {
		const binary = resolveBinary()
		if (!binary) {
			console.error(
				"[oc-donsetch] no donsetch binary found (install it with: npm i -g donsetch, or set DONSETCH_BINARY); the MCP server will not start",
			)
			return
		}

		// Once a day, on the first prompt after the date changes. Not per session: sessions are continued
		// for days here. Not on a clock: that is what the launchd agent this replaced did.
		await context.session.hook("prompt", () => checkUpdate(binary))
	},
})

