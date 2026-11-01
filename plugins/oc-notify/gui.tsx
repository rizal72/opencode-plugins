// oc-notify — GUI half.
//
// One page in the app's settings: the configuration the file holds, drawn with the app's own controls so it
// looks like the rest of the window. Every read and every write goes through `rpc.ts` — the configuration is
// a file on the server, and a window has no filesystem.
//
// The rows are ours, and only the controls are the host's: a settings page is a section of the app's list,
// and nothing there hands a plugin a row component (`docs/gui-plugins.md`). Every row is built the same way —
// a title, its control, a muted note — because mixing a host `Switch`, which draws its own label inline,
// with hand-made rows is what made the first draft uneven.
import { Plugin, SettingsPage, createKeyed } from "@opencode/plugin/gui"
import { For, Show, createSignal } from "solid-js"

import { MODES, Notify, TOPIC, type Mode, type Snapshot } from "./rpc.ts"

const LABELS: Record<Mode, string> = {
	always: "Every turn",
	away: "Only when I am away",
	off: "Never",
}

/** A row of the host's list: a hairline under it that follows the theme's text colour. */
const ROW = {
	display: "flex",
	"flex-direction": "column",
	gap: "8px",
	padding: "14px 0",
} as const

/** The hairline between rows, and none after the last: two rules around one gap read as a heavier one. */
const RULE = "1px solid color-mix(in srgb, currentColor 10%, transparent)"

const TITLE = { "font-size": "14px", "font-weight": "500" } as const

/** The host never exposes its muted colour, so the note fades the inherited one instead of guessing a token. */
const NOTE = { "font-size": "13px", "line-height": "1.45", opacity: "0.68" } as const

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export default Plugin.define({
	setup(ctx) {
		// A page of its own rather than a section of General, as the CRT plugin does: the app lists it at the
		// bottom of the settings nav, and no host page has to grow a section for us.
		ctx.add(SettingsPage, {
			id: "notify",
			icon: "cloud-upload",
			title: "Push notification",
			entries: [{ id: "notify", title: "Push notification", description: "A notification on the phone when a turn ends" }],
			render: () => <Page ctx={ctx} />,
		})
	},
})

function Page(props: { ctx: any }) {
	const ui = props.ctx.ui
	const [state, setState] = createSignal<Snapshot | undefined>(undefined)
	const [mode, setMode] = createSignal<Mode>("always")
	const [minutes, setMinutes] = createSignal("5")
	const [title, setTitle] = createSignal(false)
	const [topic, setTopic] = createSignal("")
	const [problem, setProblem] = createSignal<string | undefined>(undefined)
	const [saving, setSaving] = createSignal(false)

	/** The desktop's own server, and the first listed one otherwise, for a window talking to something else. */
	const call = () => {
		const listed = props.ctx.servers.list().map((id: string) => props.ctx.servers.get(id))
		const server = listed.find((entry: any) => entry?.builtin) ?? listed.find((entry: any) => !!entry)
		return server?.client.rpc(Notify)
	}

	const show = (next: Snapshot) => {
		setState(next)
		setMode(next.mode)
		setMinutes(String(next.awayAfter))
		setTitle(next.includeTitle)
		setTopic(next.topic)
		setProblem(undefined)
	}

	/** The file's truth, through the server: a window keeps no copy of its own. */
	const read = async () => {
		const rpc = call()
		if (!rpc) return
		try {
			show(await rpc.get({}))
		} catch (error) {
			setProblem(message(error))
		}
	}

	// A settings page can mount before the app lists a server, so the read waits for the list to have one.
	createKeyed(
		() => props.ctx.servers.list().length,
		() => void read(),
	)

	const save = async () => {
		const rpc = call()
		const awayAfter = Number(minutes())
		if (!rpc || saving()) return
		if (!Number.isFinite(awayAfter) || awayAfter < 0) {
			setProblem("Minutes of no input: a number, zero or more")
			return
		}
		setSaving(true)
		try {
			show(await rpc.set({ mode: mode(), awayAfter, includeTitle: title(), topic: topic() }))
		} catch (error) {
			// The file kept its value: read it back, so a refused write cannot leave a row claiming otherwise.
			await read()
			setProblem(message(error))
		} finally {
			setSaving(false)
		}
	}

	/** The two typed fields save on Enter or on the button; a switch and a choice save on the click. */
	const dirty = () => {
		const current = state()
		return !!current && (Number(minutes()) !== current.awayAfter || topic() !== current.topic)
	}

	return (
		<div style={{ display: "flex", "flex-direction": "column" }}>
			<Show
				when={state()}
				fallback={
					<div style={{ padding: "14px 0" }}>
						<ui.Loader />
					</div>
				}
			>
				{() => (
					<>
						<div style={{ ...ROW, "border-bottom": RULE }}>
							<span style={TITLE}>When to notify</span>
							<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
								<For each={[...MODES]}>
									{(entry: Mode) => (
										<ui.Button
											variant={mode() === entry ? "contrast" : "neutral"}
											disabled={saving()}
											onClick={() => {
												setMode(entry)
												void save()
											}}
										>
											{LABELS[entry]}
										</ui.Button>
									)}
								</For>
							</div>
						</div>

						<div style={{ ...ROW, "border-bottom": RULE }}>
							<span style={TITLE}>Minutes of no keyboard or mouse input that count as away</span>
							<ui.TextInput
								label="Minutes away"
								value={minutes()}
								onInput={setMinutes}
								onSubmit={() => void save()}
								disabled={saving() || mode() !== "away"}
							/>
							<span style={NOTE}>
								macOS's own idle counter: a screen switched off by hand still counts as away. On another system
								this mode notifies every turn.
							</span>
						</div>

						<div style={{ ...ROW, "border-bottom": RULE }}>
							<div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px" }}>
								<span style={TITLE}>Send the session's title</span>
								<ui.Switch
									label="Send the session's title"
									hideLabel
									checked={title()}
									onChange={(checked: boolean) => {
										setTitle(checked)
										void save()
									}}
									disabled={saving()}
								/>
							</div>
							<span style={NOTE}>
								The title is what says which session finished. It travels in clear through the relay.
							</span>
						</div>

						<div style={ROW}>
							<span style={TITLE}>Topic on ntfy.sh</span>
							<ui.TextInput
								label="ntfy topic"
								value={topic()}
								onInput={setTopic}
								onSubmit={() => void save()}
								invalid={!TOPIC.test(topic())}
								disabled={saving()}
							/>
							<span style={NOTE}>
								In the ntfy app on the phone: Subscribe to topic, then paste this string. It works as a password — whoever knows it
								can read what arrives here — so if it leaks, change it and subscribe to the new one in the app.
							</span>
						</div>

						<Show when={dirty()}>
							<div style={ROW}>
								<ui.Button variant="contrast" busy={saving()} onClick={() => void save()}>
									Save
								</ui.Button>
							</div>
						</Show>

						<Show when={state()?.broken}>
							<div style={ROW}>
								<span style={NOTE}>The file on disk does not parse: these are the last settings that did.</span>
							</div>
						</Show>
					</>
				)}
			</Show>

			{/* Outside the loaded branch on purpose: the first read can fail, and that error is the one the page
			    must show instead of a loader that never stops. */}
			<Show when={problem()}>
				<div style={{ padding: "14px 0" }}>
					<span style={NOTE}>{problem()}</span>
				</div>
			</Show>
		</div>
	)
}
