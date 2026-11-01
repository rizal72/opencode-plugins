// oc-budget/header-menu.tsx — the popover the header figure opens, and the only place this plugin decides how
// a dropdown is built. The pattern is the app's own (`packages/gui-plugins/src/details/popover.tsx`): the open
// state is ours, so a second click on the trigger closes what the first opened. The platform's
// `popover="auto"` cannot do that — it dismisses on any click outside the panel, and the trigger is outside,
// so the click that should close arrives at a button whose panel is already gone and reopens it.
//
// It sits inside this plugin, with one consumer: the second slot that needs a dropdown lifts it out as it is.
// The library is Kobalte, pinned to the version the app itself ships — `docs/oc-budget.md`, *The header
// popover*.
import { Popover } from "@kobalte/core/popover"

export function HeaderMenu(props: {
	/** The accessible name, on the trigger and on the panel. */
	readonly label: string
	/** The tooltip while the trigger is hovered; the host's component, so the shell stays free of the plugin. */
	readonly hint: string
	/** The host's Tooltip component, passed in so the shell stays free of the plugin context. */
	readonly tip: any
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	/** What the trigger draws; the button around it is the popover's, so press and focus are the host's. */
	readonly trigger: JSX.Element
	readonly children: JSX.Element
}) {
	const Tip = props.tip

	return (
		<Popover
			open={props.open}
			onOpenChange={props.onOpenChange}
			placement="bottom-end"
			gutter={6}
			overflowPadding={12}
		>
			<Tip value={props.hint} placement="bottom">
				<Popover.Trigger
					class={`ocb-head ${props.open ? "ocb-head-on" : ""}`}
					aria-label={props.label}
					aria-haspopup="dialog"
					aria-expanded={props.open}
				>
					{props.trigger}
				</Popover.Trigger>
			</Tip>
			<Popover.Portal>
				<Popover.Content class="ocb-pop" role="dialog" aria-label={props.label}>
					{props.children}
				</Popover.Content>
			</Popover.Portal>
		</Popover>
	)
}
