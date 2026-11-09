// oc-plugin-updates — GUI half: the pill, and the rows behind it that do the act.
//
// The states, the reasons for `rows` over `menu`, and where a failure lives are in
// `docs/oc-plugin-updates.md`.
import { Command, ComposerPill, Plugin, type ComposerPillRow } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"

import { Updates, withTimeout, type CheckResult, type UpdateResult, type UpdateRow } from "./rpc.ts"

const CHECK_TIMEOUT_MS = 60_000
const UPDATE_TIMEOUT_MS = 180_000
/**
 * Five minutes is `oc-budget`'s clock for the same kind of value — a figure that moves when the user acts,
 * not on the hour.
 */
const REFRESH_MS = 5 * 60 * 1000

/** How long ago a reading was taken: minutes under an hour, hours above. */
const age = (at: number): string => {
	const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
	return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

export default Plugin.define({
	setup(ctx) {
		const [rows, setRows] = createSignal<UpdateRow[] | undefined>(undefined)
		/** When the list was read: a held reading must be able to say how old it is. */
		const [readAt, setReadAt] = createSignal(0)
		/** The last check failed. Distinct from "nothing to update": one is a held reading, the other a guess. */
		const [checkFailed, setCheckFailed] = createSignal<string | undefined>(undefined)
		const [updateFailed, setUpdateFailed] = createSignal<string | undefined>(undefined)
		/** The target being updated, or `all`. Rows are inert while it is set: there is no second call to make. */
		const [updating, setUpdating] = createSignal<string | undefined>(undefined)
		let started = false

		const client = () => ctx.sessions.current()?.server.client

		// One clock per window: the host runs setup once for each, so a second window is a second clock —
		// and every composer in that window reads the same signals.
		const timer = setInterval(() => void check(false), REFRESH_MS)
		onCleanup(() => clearInterval(timer))

		// A window can open on Home, where no session is routed and there is no client to ask: retry the
		// first read every few seconds instead of waiting out the clock.
		let attempts = 0
		const boot = setInterval(() => {
			if (started || attempts++ >= 20) {
				clearInterval(boot)
				return
			}
			if (!client()) return
			started = true
			void check(false)
			clearInterval(boot)
		}, 3000)
		onCleanup(() => clearInterval(boot))

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
					setReadAt(value.at ?? Date.now())
					setCheckFailed(undefined)
					return
				}
				setCheckFailed(value.error ?? "check failed")
				if (value.rows) {
					setRows(value.rows)
					setReadAt(value.at ?? 0)
				}
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
				else {
					setUpdateFailed(value.error ?? "update failed")
					// Another client is updating right now: our list is the stale one by definition.
					if (value.busy) void check(true)
				}
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
				if (!started && client()) {
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
							{
								id: "check-failed",
								label: "check failed — retry",
								icon: "circle-exclamation" as const,
								tone: "danger" as const,
								run: () => void check(true),
							},
						],
					}
				}

				const caption = busy
					? "Updating plugins…"
					: updateError
						? `Update failed: ${updateError}`
						: checkError
							? `Check failed: ${checkError}${readAt() ? ` · last read ${age(readAt())} ago` : ""}`
							: "Plugin updates"

				const menu = (): ComposerPillRow[] => [
					...(checkError
						? [
								{
									id: "check-failed",
									label: "check failed — retry",
									icon: "circle-exclamation" as const,
									tone: "danger" as const,
									run: () => void check(true),
								},
							]
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

				// A true zero: nothing to say, unless the last attempt failed.
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

				// A refused update (one is already running on this server) leaves the rows as they were:
				// the reason is on the capsule, and the next click is the retry.
				return {
					// The circled arrow: `refresh`, the one glyph of this kind already drawn in this app
					// (`plugins/oc-models-pro/gui.tsx`).
					icon: "refresh" as const,
					label: busy ? "updating…" : `${checkError ? "~" : ""}${list.length}`,
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
			run: () => {
				void check(true)
			},
		}))
	},
})
