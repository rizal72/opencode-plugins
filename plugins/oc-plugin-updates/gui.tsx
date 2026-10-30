// oc-plugin-updates — GUI half.
//
// The pill says which installed plugins have a newer version, and the rows behind it are
// the act: one row per plugin updates that one, the last row updates them all. The click closes the
// popover, so nothing here draws an outcome — the server reloads the locations, this plugin restarts, and
// the pill that comes back is the fresh reading.
//
// Which is why a failure has to live on the capsule: the popover is already gone when we know. `rows` also
// has no line to put an error in, so the error is the pill's `title` — the popover's heading — and the
// first row says `update failed` without a `run`, for the user who reopens it.
//
// `rows` and not a `menu`: the list is fixed, nothing in it is ours to draw, and the host owns the width —
// the opposite of the popover a `menu` gives us, whose width we cannot change either (`docs/gui-plugins.md`).
import { Command, ComposerPill, Plugin, type ComposerPillRow } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"

import { Updates, withTimeout, type CheckResult, type UpdateResult, type UpdateRow } from "./rpc.ts"

/** One CLI round trip, with a cold cache paying for a version lookup. */
const CHECK_TIMEOUT_MS = 60_000
/** N packages, one install each: the guard outlasts an update, not a prompt. */
const UPDATE_TIMEOUT_MS = 180_000
/**
 * A read every quarter of an hour, and the server answers it from a six-hour cache: the pill appears on
 * its own when a package is published, instead of waiting for the window to be restarted. No prompt and no
 * keystroke is involved, so the clock costs one local call.
 */
const REFRESH_MS = 15 * 60 * 1000

export default Plugin.define({
	setup(ctx) {
		const [rows, setRows] = createSignal<UpdateRow[] | undefined>(undefined)
		/** The last check failed. Distinct from "nothing to update": one is a held reading, the other a guess. */
		const [checkFailed, setCheckFailed] = createSignal<string | undefined>(undefined)
		const [updateFailed, setUpdateFailed] = createSignal<string | undefined>(undefined)
		/** The target being updated, or `all`. Rows are inert while it is set: there is no second call to make. */
		const [updating, setUpdating] = createSignal<string | undefined>(undefined)
		let started = false

		const client = () => ctx.sessions.current()?.server.client

		// One clock for the whole machine, not per session: the answer is a list of installed packages, and
		// every mounted composer reads the same signals.
		const timer = setInterval(() => void check(false), REFRESH_MS)
		onCleanup(() => clearInterval(timer))

		const check = async (force: boolean) => {
			const server = client()
			if (!server) return
			try {
				const value = (await withTimeout(
					server.rpc(Updates).check(force ? { force: true } : {}),
					CHECK_TIMEOUT_MS,
				)) as CheckResult
				if (value.ok) {
					setRows(value.rows ?? [])
					setCheckFailed(undefined)
					return
				}
				setCheckFailed(value.error ?? "check failed")
				if (value.rows) setRows(value.rows)
			} catch (error) {
				setCheckFailed(error instanceof Error ? error.message : String(error))
			}
		}

		const update = async (targets: string[], key: string) => {
			const server = client()
			if (!server || updating()) return
			setUpdating(key)
			setUpdateFailed(undefined)
			try {
				const value = (await withTimeout(
					server.rpc(Updates).update({ targets }),
					UPDATE_TIMEOUT_MS,
				)) as UpdateResult
				// A success reloads us; when it does not, the row that was just updated is no longer news.
				if (value.ok) setRows((rows() ?? []).filter((row) => !targets.includes(row.target)))
				else setUpdateFailed(value.error ?? "update failed")
			} catch (error) {
				setUpdateFailed(error instanceof Error ? error.message : String(error))
			} finally {
				setUpdating(undefined)
			}
		}

		ctx.add(ComposerPill, {
			id: "updates",
			order: 40,
			show: (input) => {
				// The first read happens here rather than on a clock: the pill only exists on a mounted
				// composer, and the answer is one call for the whole machine, not one per session.
				if (!started) {
					started = true
					void check(false)
				}

				const list = rows()
				const busy = updating()
				const checkError = checkFailed()
				const updateError = updateFailed()

				// Nothing read yet. A fresh window starts here, and hiding until the call answers is that
				// state; a failure with no reading behind it is not — three states, never two.
				if (list === undefined) {
					if (!checkError) return undefined
					return {
						icon: "circle-exclamation" as const,
						label: "plugins",
						tone: "danger" as const,
						title: `Check failed: ${checkError}`,
						rows: [
							{ id: "check-failed", label: "check failed", icon: "circle-exclamation" as const, tone: "danger" as const },
						],
					}
				}

				const caption = busy
					? "Updating plugins…"
					: updateError
						? `Update failed: ${updateError}`
						: checkError
							? `Check failed: ${checkError}`
							: "Plugin updates"

				const menu = (): ComposerPillRow[] => [
					...(checkError
						? [{ id: "check-failed", label: "check failed", icon: "circle-exclamation" as const, tone: "danger" as const }]
						: []),
					...(updateError
						? [{ id: "update-failed", label: "update failed", icon: "circle-exclamation" as const, tone: "danger" as const }]
						: []),
					...(busy
						? [{ id: "busy", label: `Updating ${busy === "all" ? "all" : busy}…`, icon: "refresh" as const, tone: "warning" as const }]
						: []),
					...list.map((row) => ({
						id: row.id ?? row.target,
						label: row.id ?? row.target,
						icon: "download" as const,
						tone: "warning" as const,
						...(row.version ? { detail: row.version } : {}),
						// No `run` while ours is in flight: a row without one is not clickable, which is the
						// whole guard — the server never sees a second update for the same machine.
						...(busy ? {} : { run: () => void update([row.target], row.id ?? row.target) }),
					})),
					...(busy || !list.length
						? []
						: [
								{
									id: "all",
									label: "Update all",
									icon: "refresh" as const,
									run: () => void update(list.map((row) => row.target), "all"),
								},
							]),
				]

				// A true zero: nothing to say. Unless the last attempt failed, and then silence is the lie.
				if (!list.length) {
					if (!checkError && !updateError) return undefined
					return {
						icon: "circle-exclamation" as const,
						label: "plugins",
						tone: "danger" as const,
						title: caption,
						rows: [
							{ id: "retry", label: "check for updates", icon: "refresh" as const, run: () => void check(true) },
						],
					}
				}

				return {
					// The circled arrow: `refresh`, the one glyph of this kind already drawn in this app
					// (`plugins/oc-models-pro/gui.tsx`). `tone` colours the icon, never the label.
					icon: "refresh" as const,
					// The count alone: the arrow already says what it is, and the click says the rest. The
					// word lives in `title`, which is the capsule's accessible name and the popover's heading.
					label: busy ? "updating…" : `${checkError ? "~" : ""}${list.length}`,
					// A held reading is a warning, a failed act a danger: one says "old", the other "broken".
					tone: updateError ? ("danger" as const) : ("warning" as const),
					title: caption,
					rows: menu(),
				}
			},
		})

		ctx.add(Command, (): Command => ({
			id: "check",
			title: "Plugins: check for updates",
			description: "Update installed plugins: one by one, or all of them at once",
			keywords: "plugin update version upgrade install",
			section: "general",
			slash: { name: "plugin-updates" },
			// The pill is absent when there is nothing to show, so this is the only way to ask again after
			// an update, or on the machine where the list has been empty for a week.
			run: () => {
				void check(true)
			},
		}))
	},
})
