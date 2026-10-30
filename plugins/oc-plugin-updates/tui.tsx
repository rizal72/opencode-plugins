// oc-plugin-updates — TUI half.
//
// The terminal gets the same act as the pill, in two pieces. The sidebar carries the **signal**: one line,
// `↻ 2 updates`. The **act** happens in a centred dialog — a row per plugin, `Update all` underneath —
// because a modal is where the host gives us focus, selection and buttons, and the sidebar is a line of
// text that has none of the three.
//
// `/plugin-updates` opens the same dialog, so the affordance survives the line being absent, which it is
// whenever everything is current.
//
// **Every signal is read inside JSX.** A Solid component body runs once — reading a signal there and
// deciding in it froze the first version of `oc-budget`'s popover on "reading…" for ever
// (`docs/oc-budget.md`), and it froze the first version of this half at null, before the first check.
//
// **A row without a handler is not clickable**, and the server refuses a second update of its own: a second
// window, the other client, or a client past its timeout would otherwise still ask.
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal } from "solid-js"

import { Updates, withTimeout, type CheckResult, type UpdateResult, type UpdateRow } from "./rpc.ts"

/** The circled arrow of the pill, md-update (U+F06B0) — the same idea, the same shape. */
const GLYPH = "\u{f06b0}"

/** The pill's cadence and the pill's caches: the server answers from six hours of its own. */
const REFRESH_MS = 5 * 60 * 1000
const CHECK_TIMEOUT_MS = 60_000
/** N packages, one install each: the guard outlasts an update, not a render. */
const UPDATE_TIMEOUT_MS = 180_000

const FALLBACK_YELLOW = "#d29922"
const FALLBACK_RED = "#f85149"
const FALLBACK_DIM = "#8b949e"

export default Plugin.define({
	id: "oc-plugin-updates.tui",
	setup(context: any) {
		const themeColour = (...paths: string[][]): any => {
			for (const path of paths) {
				let node: any = context.theme
				for (const key of path) node = node?.[key]
				if (node !== undefined && node !== null) return node
			}
			return undefined
		}
		const BASE = themeColour(["text", "base"])
		const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
		/** News, not a state: the yellow the other blocks use for "there is something to do". */
		const YELLOW =
			themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ??
			FALLBACK_YELLOW
		const RED = themeColour(["text", "feedback", "error", "base"], ["syntax", "error"]) ?? FALLBACK_RED
		/** The panel's own furniture. No background highlight: a themed pair of colours can resolve to the
		 *  same value and the row goes blank, which is what the first version did. */
		const BORDER = themeColour(["border", "base"], ["text", "faint"]) ?? FALLBACK_DIM
		const ACCENT = themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? BASE

		const rpc = context.client.rpc(Updates)
		const [rows, setRows] = createSignal<UpdateRow[] | undefined>(undefined)
		const [checkFailed, setCheckFailed] = createSignal<string | undefined>(undefined)
		const [updateFailed, setUpdateFailed] = createSignal<string | undefined>(undefined)
		/** The target being updated, or `all`. Rows are inert while it is set. */
		const [updating, setUpdating] = createSignal<string | undefined>(undefined)
		/** What the last attempt asked for, so a failed update retries the update and not a read. */
		let lastTargets: string[] = []

		async function check(force = false): Promise<void> {
			try {
				const value = (await withTimeout(rpc.check(force ? { force: true } : {}), CHECK_TIMEOUT_MS)) as CheckResult
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

		async function update(targets: string[], key: string): Promise<void> {
			// The real guard: removing a handler depends on the renderer, this does not.
			if (updating()) return
			lastTargets = targets
			setUpdating(key)
			setUpdateFailed(undefined)
			try {
				const value = (await withTimeout(rpc.update({ targets }), UPDATE_TIMEOUT_MS)) as UpdateResult
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

		/** Retry what failed: the update if one failed, the read otherwise. */
		const retry = (): void => {
			if (updateFailed() && lastTargets.length > 0) {
				void update(lastTargets, lastTargets.length > 1 ? "all" : lastTargets[0])
				return
			}
			void check(true)
		}

		const list = () => rows() ?? []
		/** Draw the line at all? A true zero says nothing; a failure with no reading behind it says a lot,
		 *  and so does a held reading whose last check failed. */
		const visible = () => {
			const held = rows()
			if (held === undefined) return Boolean(checkFailed())
			return held.length > 0 || Boolean(checkFailed()) || Boolean(updateFailed())
		}
		/** The line's text: never a zero dressed as news, never a stale count without its mark. */
		const text = () => {
			const held = rows()
			if (!held || held.length === 0) return "check failed"
			const count = `${held.length} ${held.length === 1 ? "update" : "updates"}`
			return checkFailed() ? `~${count}` : count
		}

		/** A terminal button: brackets and a colour, with the label turning yellow under the pointer. No
		 *  background and no border, so nothing can make the label unreadable. `onMouseOut` is the half that
		 *  turns it off again: without it the colour stays on for ever. */
		const Button = (props: { label: string; run: () => void }) => {
			const [hover, setHover] = createSignal(false)
			return (
				<box
					flexDirection="row"
					onMouseOver={() => setHover(true)}
					onMouseMove={() => setHover(true)}
					onMouseOut={() => setHover(false)}
					onMouseDown={props.run}
				>
					<text fg={hover() ? YELLOW : ACCENT} wrapMode="none">[ {props.label} ]</text>
				</box>
			)
		}

		const Row = (props: { row: UpdateRow }) => (
			<box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
				<text fg={YELLOW} wrapMode="none">{(props.row.id ?? props.row.target).padEnd(24)}</text>
				<text fg={DIM} wrapMode="none">{props.row.version ?? ""}</text>
				{/* The button goes to the right edge: the dialog's width is the host's, so the room is used
				    rather than fought. */}
				<box flexGrow={1} />
				<Button label="Update" run={() => void update([props.row.target], props.row.id ?? props.row.target)} />
			</box>
		)

		const Panel = () => (
			<box
				flexDirection="column"
				border={["top", "bottom", "left", "right"]}
				borderColor={BORDER}
				paddingLeft={1}
				paddingRight={1}
			>
				{/* A blank line at the top as well as at the bottom, or the border sits closer above than beside. */}
				<text wrapMode="none"> </text>
				<text fg={BASE} wrapMode="none">
					<span style={{ fg: DIM }}>{GLYPH} </span>
					<b>Plugin updates</b>
					<span style={{ fg: DIM }}>{" · "}{list().length}</span>
				</text>
				<text wrapMode="none"> </text>
				<Show when={updateFailed() ?? checkFailed()}>
					{(error: () => string | undefined) => (
						<box height={1} paddingLeft={1} paddingRight={1} onMouseDown={retry}>
							<text fg={RED} wrapMode="word">
								{updateFailed() ? "update failed" : "check failed"}: {error()} — click to retry
							</text>
						</box>
					)}
				</Show>
				<Show when={rows() === undefined && !checkFailed()}>
					<box paddingLeft={1}>
						<text fg={DIM} wrapMode="none">Reading…</text>
					</box>
				</Show>
				<Show when={rows() !== undefined && list().length === 0 && !updateFailed() && !checkFailed()}>
					<box paddingLeft={1}>
						<text fg={DIM} wrapMode="none">Everything is current.</text>
					</box>
				</Show>
				<For each={list()}>{(row: UpdateRow) => <Row row={row} />}</For>
				<text wrapMode="none"> </text>
				{/* The action and the way out share one line: the host closes on escape, and a modal with no
				    visible exit is a modal people are afraid of. */}
				<box flexDirection="row">
					<Show when={list().length > 0}>
						<Show
							when={updating()}
							fallback={<Button label="Update all" run={() => void update(list().map((row) => row.target), "all")} />}
						>
							{(key: () => string) => <text fg={DIM} wrapMode="none">Updating {key() === "all" ? "all" : key()}…</text>}
						</Show>
					</Show>
					<box flexGrow={1} />
					<text fg={DIM} wrapMode="none">esc to close</text>
				</box>
				<text wrapMode="none"> </text>
			</box>
		)

		const open = (force: boolean): void => {
			// `set` talks to the *active* dialog, so it has to follow `show`: before it applies to nothing,
			// and the "centred" of the record was never true.
			context.ui.dialog.show(() => <Panel />)
			context.ui.dialog.set({ size: "medium", centered: true })
			// Opening is the moment the list matters. From the command it is a fresh ask; from the line it
			// is the cached one, because a click is cheap and a registry read is not.
			void check(force)
		}

		const Line = () => (
			<Show when={visible()}>
				{/* The dialog opens under the pointer, so opening on the press made the release land outside it
				    and close it again — one click in three. The release is the moment the modal can survive. */}
				<box height={1} onMouseUp={() => open(false)}>
					<text fg={YELLOW} wrapMode="none">
						{GLYPH} {text()} — /plugin-updates
					</text>
				</box>
			</Show>
		)

		// The signal, not the act: the sidebar is where a reader looks, the dialog is where the buttons are.
		context.ui.slot({ prepend: "sidebar.content", render: () => <Line /> })

		// The other door, and the one that works when the line is absent because everything is current.
		context.keymap.layer(() => ({
			commands: [
				{
					id: "oc-plugin-updates.open",
					title: "Plugins: updates",
					description: "Show the installed plugins with a newer version",
					group: "plugin",
					palette: true,
					slash: { name: "plugin-updates" },
					run: () => open(true),
				},
			],
		}))

		void check()
		const clock = setInterval(() => void check(), REFRESH_MS)

		return () => clearInterval(clock)
	},
})
