# oc-plugin-updates — the record

The pill that says which installed plugins have a newer version, and the click that updates them. It exists
because V2 checks and never applies: *"checks unpinned npm and Git plugins for updates
without changing the installed package"* — `opencode plugin check` reports, `opencode plugin update` is a
gesture the user has to know exists, and neither the window nor the terminal says a word. Measured
2026-10-29 on this machine: `github-panel` ran 0.1.0 with 0.2.0 published, through several app updates and
service restarts, and nothing surfaced it.

## The two calls

Both are the server's own routes; the CLI is only the client that knows how to reach them.

| route | body | answer |
|---|---|---|
| `POST /api/plugin/check` | `{"target": null}` | `{location, data: Plugin.Info[]}`; a package plugin carries `source.outdated: true` only when it is behind |
| `POST /api/plugin/update` | `{"targets": ["@scope/pkg", …]}` | `204` once every update finished, having told the active locations to reload — **no restart**; fails when any update fails |

An unknown target answers `400` with the server's own sentence (`Plugin packages are not in the current
server inventory: …`), which is what the pill shows when an update fails. Measured warm: a check is ~0.7 s,
a no-op update ~0.1 s; a real one is one package install per target, hence the 180 s guard.

**Why the CLI and not an in-process call.** The plugin context carries `plugin: Pick<PluginApi, "list">` —
`list` alone. The routes exist on the server, but nothing in the SDK reaches them, so the server half spawns
`process.execPath api post …` (falling back to `opencode` on PATH), which is a separate client process and
therefore cannot deadlock against the server it calls.

**Unpinned only.** An exact version and a range are both reported `current`: the app treats a pin as
deliberate, which is the documented behaviour and was measured on 2026-10-30 (`@0.1.0` and `@~0.1.0` both
`current` while `0.2.0` was published). So a pinned package can never appear in the pill, and pinning is not
a way to test it.

## The surface: `rows`, not `menu`

The list is fixed and the action is one click, so the host draws it. `detail` is the version — a bordered
chip at the row's end, which is what puts the name left and the version right without a line of our CSS. A
row with no `run` is not clickable, which is the whole busy guard: while an update is in flight every row
loses its action, so the server never sees a second call for the same machine.

The click closes the popover, so no outcome can be drawn inside it. That is why a failure lives on the
capsule — danger red, the reason as the popover's heading — and why the popover reopens with a red
`update failed` line among the rows, below `check failed` when both are set.
The alternative, a `menu` with its own error line, would have needed our own CSS for a layout the host
already gets right, and its width is fixed anyway.

## The TUI: signal in the sidebar, act in a dialog

The sidebar carries one line and nothing else — `↻ 2 updates`. The act happens in `ui.dialog.show`, a
centred modal (`ui.dialog.set({ size: "medium", centered: true })`) with a row per plugin and `Update all`,
reachable by clicking the line or by `/plugin-updates` (`keymap.layer`, with a palette entry).

The block was the first shape and it was the wrong one: a sidebar row is a click target with no affordance —
no focus, no selection, and no pointer to change — while a modal is the host's own surface for exactly those
three. The busy guard survives either way: a row without a click handler is not clickable, and the server
refuses a second update of its own. Two things the terminal still forces: the failure has no popover to hide
in, so it is a red line with the reason, and the version is padded to a fixed column because a dialog's
width is not ours to know either.

## The states

| state | capsule |
|---|---|
| nothing to update, reading fresh | nothing at all — a true zero |
| N behind | the count alone, `refresh`, warning |
| held reading, last check failed | `~N`, warning, the reason and the age of the reading as the heading |
| no reading at all, check failed | `plugins`, `circle-exclamation`, danger, error as the heading |
| an update running | `updating…`, rows inert |

The count is bare because the arrow and the rows say what it counts; the word lives in `title`, which is
the capsule's accessible name and the popover's heading. `tone` colours the icon, never the label
(`docs/gui-plugins.md`).

The last three are *a pill never shows a stale value as fresh*: hiding is the fourth option and it is the
wrong one.

Neither half is told when the other updates something: each reads again on its own five-minute clock, so for
up to that long one can list a plugin the other has already moved. A click in that window is refused only
while an update is actually running (`busy`); afterwards it asks the CLI for packages that are already there,
which costs nothing and changes nothing.

## Cost and refresh

One read of the registry at most every six hours, kept across restarts in `ctx.storage` as JSON text
(`Schema.Json` is not a list of objects). Each half asks again every five minutes and the server answers from
that cache, so the frequent call is local and the network is paid at most four times a day.
`Plugins: check for updates` and the terminal's `/plugin-updates` force a read — the only way to ask while
the pill is invisible — while a click on the sidebar line opens the dialog with the cached list, because a
click is cheap and a registry read is not.

## What it does not do

The version the plugin would become: `Plugin.Info` carries the installed `version` and `outdated: true`,
not the target, and `opencode plugin check` does not know it either. One lookup per package would buy it.

## Testing

`OC_PLUGIN_UPDATES_DEV=outdated|fail|slow` fakes what a healthy machine cannot reach. It only works when
the variable reaches the **service**, and on macOS the service is not a child of the app shell: measured
2026-10-30, `OC_PLUGIN_UPDATES_DEV=… opencode service restart` leaves the variable out, and relaunching the
app inherits it only until the old service is reused. Stop the service, then start it with the variable in
the environment.
