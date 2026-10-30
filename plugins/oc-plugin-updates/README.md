# @rizal72/oc-plugin-updates

The installed plugins that have a newer version, in a pill above the composer, with the click that updates
them one by one or all at once.

OpenCode V2 checks unpinned package plugins at startup and **never applies the update**: `plugin check`
reports, `plugin update` is a command the user has to know exists, and the window says nothing either way.
That is how a machine runs a plugin three versions old without a hint. This plugin is the missing signal,
and the act behind it: the same two calls the CLI makes, in one click.

## Install

```sh
opencode plugin add @rizal72/oc-plugin-updates
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-plugin-updates"]
```

## Update

V2 checks package plugins at startup and never applies the update, so a package only moves when you ask:

```sh
opencode plugin check     # which of the installed packages are behind
opencode plugin update    # apply them, and let the server reload
```

Or install [`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates): the
count appears in a pill above the composer, with the update one click away.

## TUI

A line in the sidebar — `↻ 2 updates` — and `/plugin-updates` opens a centred dialog with a row per plugin
and `Update all` underneath; clicking the line does the same. The line is the signal and is absent while
everything is current; the dialog is the act, because a modal is where the terminal gives focus, selection
and buttons. While an update runs the action is refused, so a second one cannot start, and a failure is a
red line with the reason.

The line keeps the pill's three states: a bare count when the reading is fresh, `~2 updates` when the last
check failed and the count is held, and `check failed` when there is nothing to hold — never a zero standing
in for silence.

## GUI

Nothing at all while everything is current — the pill appears only when there is something to install.

```
2                             ← the capsule, with the circled arrow; the word lives in its title
oc-git                 0.2.1  ← one row per plugin: name, installed version
oc-context             0.3.2
Update all
```

Any row updates that plugin alone; `Update all` updates every one. The click closes the popover, the
server reloads the locations, and the pill comes back with the fresh reading — no restart, and no need to
reload anything by hand.

While an update is running the rows have no action and the capsule reads `updating…`, so a second click
cannot start a second update. A failure leaves the popover closed by that point, so it is reported on the
capsule — the count with its icon in danger red, the reason as the heading — and the popover reopens with the
rows as they were and a red `update failed` line among them.

Two more states, both from `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*: a check that
failed while the last reading is held shows `~N` and the age of that reading in the heading, and a check that
failed with no reading at all shows `plugins` with the error, never nothing.

The server reads the registry at most once every six hours and keeps it across restarts; the pill asks every
five minutes and gets that cache. `Plugins: check for updates` in the command palette — or
`/plugin-updates` — forces a fresh read, which is the only way to ask again while the pill is invisible.

## Testing

`OC_PLUGIN_UPDATES_DEV=outdated|fail|slow` fakes the states a healthy machine cannot reach: packages with
updates behind them, a failing update, a slow one. Unset, it does nothing.

## Not covered

The version the plugin would become. `Plugin.Info` carries the installed `version` and `outdated: true`,
not the target — `opencode plugin check` does not know it either. Getting it would cost one lookup per
package.
