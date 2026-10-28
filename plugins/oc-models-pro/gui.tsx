// oc-models-pro — GUI half.
//
// The native picker already searches, keeps favourites and picks variants; a copy of it would be worse
// than the original. This is the other thing: a table, wide enough to compare, sorted by clicking.
//
// The data is the terminal's, assembled in the server half (`index.ts`) because a window has no Node and
// no environment. The switch is the app's own path — `composer.setModel` — so nothing here writes the
// session or the prefs file to change a model.
//
// Three rules came over from the terminal unchanged, because they are what makes the list readable:
// the model in use is never buried, free models never head a price order, and a provider is a group
// rather than a column.
import { Command, MenuItem, Panel, Plugin, Style, type PanelTab } from "@opencode/plugin/gui"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

import { Models, type ModelsSnapshot } from "./rpc.ts"
import { ORDER, ORDERS, arrange, compare, direction, isFree, type Row, type Section, type SortKey } from "./rows.ts"

const REFRESH_MS = 5 * 60 * 1000
/** A call that never answers must not freeze the table and its Refresh button for ever. The timer is
 *  cleared with the answer: the same helper the other pills carry, in the version that does not leak. */
const RPC_TIMEOUT_MS = 15_000
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`rpc timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})

const CSS = `
.omp { container-type: inline-size; display: flex; flex-direction: column; height: 100%; min-height: 0;
  font-size: 12px; }
.omp-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; flex-wrap: wrap; }
.omp-scopes { display: flex; gap: 2px; margin-left: auto; }
.omp-scope { background: none; border: 0; border-radius: 4px; color: inherit; cursor: pointer; font: inherit;
  opacity: .55; padding: 2px 6px; }
.omp-scope[data-on] { background: color-mix(in srgb, currentColor 12%, transparent); opacity: 1; }
.omp-head, .omp-row { display: grid; align-items: center; gap: 6px; padding: 2px 8px;
  grid-template-columns: minmax(9rem, 1fr) 2.8rem 3.4rem 3.4rem 2.4rem 2.4rem 2.6rem 2.2rem; }
.omp-head { border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); opacity: .7;
  padding-right: calc(8px + var(--omp-gutter, 0px)); }
.omp-head button { background: none; border: 0; color: inherit; cursor: pointer; font: inherit; padding: 0;
  text-align: left; }
.omp-head .omp-num { text-align: right; }
.omp-body { overflow: auto; min-height: 0; }
.omp-group { padding: 8px 8px 4px; text-transform: uppercase; letter-spacing: .04em; font-size: 10px;
  position: sticky; top: 0; z-index: 1;
  background: var(--v2-background-bg-base, Canvas);
  color: color-mix(in srgb, currentColor 55%, transparent);
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.omp-row { cursor: pointer; border-radius: 4px; }
.omp-row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.omp-row[data-mine] { background: color-mix(in srgb, currentColor 12%, transparent); }
/* A figure wider than its track is cut, as the terminal cuts every cell: it must never push into the
   column beside it and read as that column's number. */
.omp-num { text-align: right; font-variant-numeric: tabular-nums; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.omp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omp-tag { opacity: .5; margin-right: 6px; font-variant-numeric: tabular-nums; }
.omp-mine { opacity: .9; }
.omp-dot { opacity: .8; margin-right: 4px; }
.omp-fav { background: none; border: 0; cursor: pointer; color: inherit; font: inherit; opacity: .35;
  padding: 0 4px; }
.omp-fav[data-on] { opacity: 1; }
.omp-empty { padding: 12px 8px; opacity: .6; }
.omp-warn { padding: 4px 8px; opacity: .7; }
.omp-fine { padding: 4px 8px; opacity: .55; font-size: 11px;
  border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
/* The terminal's cascade, in pixels: the name shrinks first (the track is elastic), then whole columns
   go in the order fit.ts uses — tok/s, then context, then intelligence. The three price figures never
   go: they are what the list is for. Below the last rung the name truncates instead of scrolling. */
@container (max-width: 560px) {
  .omp-tps, .omp-note { display: none; }
  .omp-head, .omp-row { grid-template-columns: minmax(9rem, 1fr) 2.8rem 3.4rem 3.4rem 2.4rem 2.6rem; }
}
@container (max-width: 500px) {
  .omp-ctx { display: none; }
  .omp-head, .omp-row { grid-template-columns: minmax(9rem, 1fr) 2.8rem 3.4rem 2.4rem 2.6rem; }
}
@container (max-width: 440px) {
  .omp-int { display: none; }
  .omp-head, .omp-row { grid-template-columns: minmax(9rem, 1fr) 2.8rem 3.4rem 2.6rem; }
}
@container (max-width: 390px) {
  .omp-head, .omp-row { grid-template-columns: minmax(0, 1fr) 2.8rem 3.4rem 2.6rem; }
}
`

type Scope = "all" | "favorites" | "paying"

/** The orders a header can sort by. The others live in the menu alone, so nothing can flip them. */
const COLUMNS = new Set<SortKey>(["name", "input", "output", "context", "int", "speed"])

const usd = (value: number | undefined) => {
	if (value === undefined) return ""
	if (value === 0) return "free"
	return String(Math.round(value * 1000) / 1000)
}

const tokens = (value: number | undefined) => {
	if (value === undefined) return ""
	if (value >= 1_000_000) return (value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1) + "M"
	if (value >= 1000) return Math.round(value / 1000) + "K"
	return String(value)
}

/**
 * The terminal's two notes in four characters: `*2` is the tariff at peak, `+1.5` a promotion. 434 of
 * 436 rows have nothing to say, so the column stays the width of its own name and a line underneath
 * spells the marks out.
 * shortcut: one mark per row, peak first — a model carrying both shows only the peak, the one that
 * changes what it costs today. Widen the cell when a second mark appears.
 */
const note = (row: Row) => (row.peak ? "*" + row.peak : row.promo ? "+" + row.promo : "")

const id = (row: Row) => row.providerID + "/" + row.modelID

export default Plugin.define({
	setup(ctx) {
		const [snapshot, setSnapshot] = createSignal<ModelsSnapshot | undefined>(undefined)
		const [query, setQuery] = createSignal("")
		const [sort, setSort] = createSignal<SortKey>("effective")
		const [ascending, setAscending] = createSignal(true)
		const [scope, setScope] = createSignal<Scope>("all")
		const [grouped, setGrouped] = createSignal(true)
		const [recent, setRecent] = createSignal<string[]>([])
		const [busy, setBusy] = createSignal(false)

		let timer: ReturnType<typeof setInterval> | undefined

		const load = async (force: boolean) => {
			if (busy()) return
			// The session's own server, like the other pills: a server that does not run this plugin has no
			// catalogue to give, and the app's own server would answer with the wrong one.
			const call = current()?.server.client
			if (!call) return
			setBusy(true)
			try {
				setSnapshot(
					(await withTimeout(call.rpc(Models).snapshot(force ? { force: true } : {}), RPC_TIMEOUT_MS)) as ModelsSnapshot,
				)
			} catch (error) {
				ctx.toast.show({
					title: "Models",
					description: error instanceof Error ? error.message : String(error),
					variant: "error",
				})
			} finally {
				setBusy(false)
			}
		}

		const current = () => ctx.sessions.current()
		const mine = () => {
			const model = ctx.screen.current()?.composer.model()
			return model ? model.providerID + "/" + model.modelID : undefined
		}

		/** The filtered list, in the active order. Where the in-use row and the groups land is `arrange`'s. */
		const ordered = createMemo<Row[]>(() => {
			const value = snapshot()
			if (!value) return []
			const favourites = new Set(value.favorites)
			const inUse = mine()
			const searched = query().trim().toLowerCase()
			const list = value.rows.filter((row) => {
				// The snapshot carries `enabled`, so this half does not depend on the host's promise that
				// `model.list()` returns only the models the app has switched on: a disabled model is
				// filtered here, as the terminal filters it.
				if (!row.enabled) return false
				// The model in use survives every scope: it is the state of the session, not a preference
				// and not a price. Without it the favourites lens would hide the row and nothing could lead.
				if (scope() === "favorites" && !favourites.has(id(row)) && id(row) !== inUse) return false
				if (scope() === "paying" && isFree(row) && id(row) !== inUse) return false
				if (!searched) return true
				return (row.name + " " + row.provider + " " + row.modelID).toLowerCase().includes(searched)
			})

			// Only an order that owns a column can have its direction flipped, because only a column gives
			// the reader a control to flip it. The rest read in their natural direction: "most expensive
			// first" and "oldest first" are not questions this table is asked.
			const sign = COLUMNS.has(sort()) && !ascending() ? -1 : 1
			const context = { recent: new Map(recent().map((entry, index) => [entry, index])) }
			return [...list].sort((a, b) => compare(sort(), a, b, context, sign))
		})

		/** Which rows are drawn, and in what order: one rule, in `rows.ts`, for both surfaces. */
		const sections = createMemo<Section[]>(() => arrange(ordered(), { inUse: mine(), grouped: grouped() }))

		const choose = (row: Row) => {
			const composer = ctx.screen.current()?.composer
			if (!composer) return
			const key = id(row)
			if (!composer.setModel({ providerID: row.providerID, modelID: row.modelID })) {
				ctx.toast.show({ title: "Models", description: `${row.name} is not available on this server`, variant: "error" })
				return
			}
			setRecent([key, ...recent().filter((entry) => entry !== key)].slice(0, 20))
		}

		const star = (row: Row) => {
			const key = id(row)
			const on = snapshot()?.favorites.includes(key) ?? false
			const call = current()?.server.client
			if (!call) return
			void withTimeout(call.rpc(Models).setFavorite({ providerID: row.providerID, modelID: row.modelID, on: !on }), RPC_TIMEOUT_MS)
				.then((raw) => {
					const value = raw as { ok: boolean; favorites: string[] }
					if (!value.ok) {
						ctx.toast.show({ title: "Models", description: "model.json could not be written", variant: "error" })
						return
					}
					const previous = snapshot()
					if (previous) setSnapshot({ ...previous, favorites: value.favorites })
				})
				.catch(() => {
					// A rejection is a star that would never move, silently. Say it, as every other
					// failure path in this file does.
					ctx.toast.show({ title: "Models", description: "the favourite did not reach the server", variant: "error" })
				})
		}

		const head = (key: SortKey, label: string, cls = "") => (
			<button
				class={cls}
				onClick={() => {
					if (sort() === key) setAscending(!ascending())
					else {
						setSort(key)
						setAscending(direction(key) === 1)
					}
				}}
			>
				{label}
				{sort() === key ? (ascending() ? " ↑" : " ↓") : ""}
			</button>
		)

		const Row = (props: { row: Row }) => {
			const row = props.row
			const key = id(row)
			const favourite = () => snapshot()?.favorites.includes(key) ?? false
			const inUse = () => key === mine()
			return (
				<div class="omp-row" data-mine={inUse() ? "" : undefined} onClick={() => choose(row)}>
					<div class="omp-name" classList={{ "omp-mine": inUse() }}>
						<button
							class="omp-fav"
							data-on={favourite() ? "" : undefined}
							onClick={(event: MouseEvent) => {
								event.stopPropagation()
								star(row)
							}}
						>
							{favourite() ? "★" : "☆"}
						</button>
						<Show when={inUse()}>
							<span class="omp-dot">●</span>
						</Show>
						<span class="omp-tag">{row.tag}</span>
						{row.name}
					</div>
					<div class="omp-num">{usd(row.input)}</div>
					<div class="omp-num omp-out">{usd(row.output)}</div>
					<div class="omp-num omp-ctx">{tokens(row.context)}</div>
					<div class="omp-num omp-int">{row.int !== undefined ? row.int.toFixed(1) : ""}</div>
					<div class="omp-num omp-tps">
						{row.measured !== undefined ? Math.round(row.measured) : row.tps !== undefined ? "~" + Math.round(row.tps) : ""}
					</div>
					<div class="omp-num omp-credit">{row.credit !== 1 ? "×" + row.credit : ""}</div>
					<div class="omp-num omp-note">{note(row)}</div>
				</div>
			)
		}

		const View = () => {
			const value = () => snapshot()
			let root: HTMLDivElement | undefined
			// The list scrolls inside itself and the header sits outside it, so every row is narrower than
			// the header by the scrollbar. That width is the app's, not ours: measure it and give it to the
			// header's right padding, or each column drifts right by that many pixels. Zero when the
			// scrollbars are overlays, which is why it is measured and not written down.
			const syncGutter = () => {
				const body = root?.querySelector<HTMLElement>(".omp-body")
				if (root && body) root.style.setProperty("--omp-gutter", body.offsetWidth - body.clientWidth + "px")
			}
			// The bar appears and disappears with the number of rows; the panel moves under it.
			createEffect(() => {
				sections()
				syncGutter()
			})
			// An effect with nothing reactive in it runs once, after the first render: the observer's home.
			createEffect(() => {
				const observer = new ResizeObserver(syncGutter)
				if (root) observer.observe(root)
				onCleanup(() => observer.disconnect())
			})
			return (
				<div class="omp" ref={(el: HTMLDivElement) => (root = el)}>
					<div class="omp-bar">
						<ctx.ui.TextInput
							label="Search models"
							placeholder="Search models"
							type="search"
							value={query()}
							onInput={setQuery}
						/>
						<ctx.ui.Menu
							trigger="button"
							// The arrow is a control, not decoration: only an order that owns a column can be
							// flipped, so only that one advertises a direction.
							label={`${ORDERS[sort()].label}${COLUMNS.has(sort()) ? (ascending() ? " ↑" : " ↓") : ""}`}
							items={ORDER.map((key) => ({
								label: ORDERS[key].label,
								icon: sort() === key ? ("check" as const) : undefined,
								onSelect: () => {
									if (sort() !== key) {
										setSort(key)
										setAscending(direction(key) === 1)
									} else if (COLUMNS.has(key)) setAscending(!ascending())
								},
							}))}
						/>
						<ctx.ui.IconButton icon="refresh" label="Refresh" busy={busy()} onClick={() => void load(true)} />
						<div class="omp-scopes">
							<For each={["all", "favorites", "paying"] as Scope[]}>
								{(name: Scope) => (
									<button class="omp-scope" data-on={scope() === name ? "" : undefined} onClick={() => setScope(name)}>
										{name}
									</button>
								)}
							</For>
							<button class="omp-scope" data-on={grouped() ? "" : undefined} onClick={() => setGrouped(!grouped())}>
								groups
							</button>
						</div>
					</div>
					<Show when={value()?.problems?.length}>
						<div class="omp-warn">{value()?.problems?.join(" · ")}</div>
					</Show>
					<Show when={value() && !value()!.credits}>
						<div class="omp-warn">Go credit unknown: the plan page could not be read.</div>
					</Show>
					<div class="omp-head">
						{head("name", "model")}
						{head("input", "$/M in", "omp-num")}
						{head("output", "$/M out", "omp-num omp-out")}
						{head("context", "context", "omp-num omp-ctx")}
						{head("int", "int", "omp-num omp-int")}
						{head("speed", "tok/s", "omp-num omp-tps")}
						{/* No column for `effective`, `in+out`, `recent` or `provider`: a header may only sort by
						    itself, or an order would light up a column it has nothing to do with. */}
						<span class="omp-num omp-credit">×</span>
						<span class="omp-num omp-note">note</span>
					</div>
					<div class="omp-body">
						<Show when={sections().length === 0}>
							<div class="omp-empty">{value() ? "no model matches" : "reading the catalogue…"}</div>
						</Show>
						<For each={sections()}>
							{(section: Section) => (
								<>
									<Show when={section.title}>
										<div class="omp-group">{section.title}</div>
									</Show>
									<For each={section.rows}>{(row: Row) => <Row row={row} />}</For>
								</>
							)}
						</For>
					</div>
					<div class="omp-fine">*N = the tariff at peak · +N = a promotion</div>
				</div>
			)
		}

		const tab: PanelTab = {
			id: "main",
			get title() {
				return "Models"
			},
			closable: "hover",
		}

		ctx.add(Style, CSS)
		ctx.add(Panel, {
			id: "main",
			region: "side",
			wide: true,
			list: (input) => (input.open.includes("main") ? [tab] : []),
			render: () => <View />,
			focus: () => void load(false),
		})

		const toggle = () => {
			const session = current()
			if (!session) return
			ctx.layout.toggle(`${ctx.id}:main`, session)
			void load(false)
		}

		ctx.add(Command, (): Command => ({
			id: "open",
			title: "Models: the table",
			description: "Prices, context, intelligence and the Go credit, side by side",
			keywords: "model price context credit list",
			section: "model",
			bind: "mod+shift+m",
			slash: { name: "models-pro" },
			featured: true,
			enabled: !!current(),
			run: toggle,
		}))

		ctx.add(MenuItem, (): MenuItem => {
			const session = current()
			return {
				menu: "session.panel",
				id: "models",
				title: "Models",
				icon: "models",
				description: "compare and switch",
				keybind: `${ctx.id}.open`,
				opened: !!session && ctx.layout.state(`${ctx.id}:main`, session) !== "closed",
				run: toggle,
			}
		})

		// Poll only while the panel is on screen: a snapshot costs a second of the server's work, and no
		// one reads a list nobody has open.
		timer = setInterval(() => {
			const session = current()
			if (!session) return
			if (ctx.layout.state(`${ctx.id}:main`, session) === "closed") return
			void load(false)
		}, REFRESH_MS)
		return () => {
			if (timer) clearInterval(timer)
		}
	},
})
