// oc-coffee/header-menu.tsx — the popover the header cup opens, lifted as it stands from
// `oc-budget/header-menu.tsx`: the open state is ours, so a second click on the trigger closes what the
// first opened. The record, and why the platform's `popover="auto"` cannot do that, is `docs/oc-coffee.md`.
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
					class={`occ-head ${props.open ? "occ-head-on" : ""}`}
					aria-label={props.label}
					aria-haspopup="dialog"
					aria-expanded={props.open}
				>
					{props.trigger}
				</Popover.Trigger>
			</Tip>
			<Popover.Portal>
				<Popover.Content class="occ-pop" role="dialog" aria-label={props.label}>
					{props.children}
				</Popover.Content>
			</Popover.Portal>
		</Popover>
	)
}
