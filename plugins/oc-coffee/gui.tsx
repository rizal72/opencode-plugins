// oc-coffee — GUI half.
//
// The header, not the composer: keeping a machine awake is a fact about the system, and the app's own row is
// where its system facts live, beside the context ring and the cost. It also buys the cup — a pill can only
// pick from the host's icon set, which has none, while a slot draws its own markup.
//
// The cup is Material Design Icons' `coffee-outline` (U+F06CA), the glyph the terminal's badge draws, so the
// two surfaces show one artwork instead of two imitations. Apache-2.0; the path is quoted whole.
//
// The state is not read from the system: the server holds it, having spawned the child itself, and this
// window asks over `rpc.ts`. That is what makes the cup and the badge agree — they are two views of one
// answer, not two answers.
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"

import { HeaderMenu } from "./header-menu.tsx"
import { Coffee, LEVELS, flagsText, withTimeout, type CoffeeSnapshot, type Level } from "./rpc.ts"

/** Short: the cup has to light while the agent is still working. */
const REFRESH_MS = 2_000
const RPC_TIMEOUT_MS = 15_000

/** MDI `coffee-outline`, viewBox 24 — filled, so the colour goes on `fill` and not on `stroke`. */
const CUP =
	"M2,21V19H20V21H2M20,8V5H18V8H20M20,3A2,2 0 0,1 22,5V8A2,2 0 0,1 20,10H18V13A4,4 0 0,1 14,17H8A4,4 0 0,1 4,13V3H20M16,5H6V13A2,2 0 0,0 8,15H14A2,2 0 0,0 16,13V5Z"

const CSS = `
/* The app's own header button, hand-written: its height and its hover plate are what make the cup read as one
   of the header's controls, and its geometry is the budget figure's beside it. */
.occ-head { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 6px; border: 0;
  border-radius: 6px; background: none; color: var(--v2-text-text-faint); font: inherit; font-size: 13px;
  font-weight: 440; letter-spacing: -0.04px; cursor: pointer; }
.occ-head:hover, .occ-head:focus-visible {
  background: color-mix(in srgb, var(--v2-text-text-base) 8%, transparent);
  color: var(--v2-text-text-base);
}
/* Two classes, so the open plate outranks the hover plate while the pointer still rests on the trigger. */
.occ-head.occ-head-on {
  background: color-mix(in srgb, var(--v2-text-text-base) 12%, transparent);
  color: var(--v2-text-text-base);
}
.occ-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
.occ-label { white-space: nowrap; color: inherit; }
.occ-ok { color: var(--v2-state-fg-success, inherit); }
.occ-count { text-align: right; padding: 4px 6px 0; color: var(--v2-text-text-muted, inherit); font-size: 12px; }
/* The block: Kobalte puts it in the app's own top layer and positions it from the trigger, so there is no
   position rule here, only the box. */
.occ-pop { width: max-content; min-width: 13em; padding: 6px; border-radius: 8px;
  border: 1px solid var(--v2-border-border-muted, rgba(255, 255, 255, .12));
  background: var(--v2-background-bg-layer-02, #1b1b1b);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35); color: var(--v2-text-text-base, inherit); font-size: 13px; }
.occ-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px; border: 0;
  border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.occ-row:hover, .occ-row:focus-visible {
  background: color-mix(in srgb, var(--v2-text-text-base) 8%, transparent);
}
.occ-check { display: inline-flex; align-items: center; justify-content: center; width: 14px; }
.occ-name { font-weight: 600; }
.occ-detail { margin-left: auto; padding-left: 12px; color: var(--v2-text-text-muted, inherit); font-size: 12px; }
/* The hover hint is wider than this panel, so it would show beside it: while the panel is open, no tooltip is
   drawn anywhere. The trade and its reason are oc-budget's, recorded in docs/oc-budget.md. */
body:has(.occ-head[aria-expanded="true"]) [data-component="tooltip-v2"] { display: none; }
`

export default Plugin.define({
	setup(ctx) {
		const [snapshot, setSnapshot] = createSignal<{ server: string; value: CoffeeSnapshot } | undefined>(undefined)
		let timer: ReturnType<typeof setInterval> | undefined
		let reading: string | undefined

		createEffect(() => {
			const session = ctx.sessions.current()
			const server = session?.server.id

			if (timer) clearInterval(timer)
			timer = undefined
			if (!server) {
				setSnapshot(undefined)
				return
			}

			const refresh = () => {
				if (reading === server) return
				reading = server
				void withTimeout(session!.server.client.rpc(Coffee).snapshot({}), RPC_TIMEOUT_MS)
					.then((value) => {
						if (ctx.sessions.current()?.server.id === server) setSnapshot({ server, value: value as CoffeeSnapshot })
					})
					.catch(() => {
						// Keep the last good reading: a failed read says nothing about the level.
					})
					.finally(() => {
						if (reading === server) reading = undefined
					})
			}

			refresh()
			timer = setInterval(refresh, REFRESH_MS)
		})

		onCleanup(() => {
			if (timer) clearInterval(timer)
		})

		const pick = (level: Level) => {
			const session = ctx.sessions.current()
			if (!session) return
			void withTimeout(session.server.client.rpc(Coffee).set({ level }), RPC_TIMEOUT_MS)
				.then((value) => setSnapshot({ server: session.server.id, value: value as CoffeeSnapshot }))
				.catch((error) =>
					ctx.toast.show({
						title: "Coffee",
						description: error instanceof Error ? error.message : String(error),
						variant: "error",
					}),
				)
		}

		/** The cup in the session header: lit while `caffeinate` is up, the level beside it, and the four levels
		 *  in the panel. A machine with no reading yet draws nothing — an empty cup would claim "off". */
		const HeaderCoffee = (props: { input: SlotMap["session.header"] }) => {
			const value = () => {
				const current = snapshot()
				return current && current.server === props.input.session.server.id ? current.value : undefined
			}
			const [open, setOpen] = createSignal(false)

			// A session switch can drop the reading under an open panel, and the panel would then float over a
			// trigger that is no longer drawn. Closing with it is the state that cannot lie.
			createEffect(() => {
				if (!value()) setOpen(false)
			})

			const choose = (level: Level) => {
				setOpen(false)
				pick(level)
			}

			return (
				<Show when={value()}>
					{(v: () => CoffeeSnapshot) => (
						<HeaderMenu
							label={`Coffee: ${v().level}`}
							hint="Coffee: sleep prevention"
							tip={ctx.ui.Tooltip}
							open={open()}
							onOpenChange={setOpen}
							trigger={
								<>
									<span class={`occ-mark ${v().held ? "occ-ok" : ""}`}>
										<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
											<path d={CUP} />
										</svg>
									</span>
									<Show when={!props.input.compact}>
										<span class="occ-label">{v().level}</span>
									</Show>
								</>
							}
						>
							{LEVELS.map((level) => (
								<button
									type="button"
									class={`occ-row ${level === v().level ? "occ-ok" : ""}`}
									onClick={() => choose(level)}
								>
									<span class="occ-check">
										<Show when={level === v().level}>
											{/* Drawn here, not `ctx.ui.Icon`: the SDK's icon union is wider than the set the
											    app draws, so an absent name shows a `plus` with no error. */}
											<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
												<path
													d="M3 8.5l3 3 7-7.5"
													stroke="currentColor"
													stroke-width="1.8"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
											</svg>
										</Show>
									</span>
									<span class="occ-name">{level}</span>
									<span class="occ-detail">{flagsText(level)}</span>
								</button>
							))}
							{/* Below the four levels, so a count that comes and goes never moves a target under the
							    pointer, and flush with the flags on the right for the same reason they sit there. */}
							<Show when={v().running > 0}>
								<div class="occ-count">tasks running: {v().running}</div>
							</Show>
						</HeaderMenu>
					)}
				</Show>
			)
		}

		ctx.add(Style, CSS)

		// Order 12 puts it after the budget's figure (11) and before the app's actions (20).
		ctx.add(Slot, { at: "session.header", order: 12, render: (input) => <HeaderCoffee input={input} /> })
	},
})
