# @rizal72/oc-plugin-updates

The installed package plugins your registry has moved past, in a pill above the composer, with the click
that updates them.

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

## What it draws

Nothing at all while everything is current — the pill appears only when there is something to install.

```
2 updates                     ← the capsule, with the circled arrow
oc-git                 0.2.1  ← one row per plugin: name, installed version
oc-context             0.3.2
Update all
```

Any row updates that plugin alone; `Update all` updates every one. The click closes the popover, the
server reloads the locations, and the pill comes back with the fresh reading — no restart, and no need to
reload anything by hand.

While an update is running the rows have no action and the capsule reads `updating…`, so a second click
cannot start a second update. A failure leaves the popover closed by that point, so it is reported on the
capsule: `N updates` in danger red, with the reason as the heading, and `update failed` as the first row
when you reopen it.

Two more states, both from `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*: a check that
failed while the last reading is held shows `~N updates`, and a check that failed with no reading at all
shows `plugins` with the error, never nothing.

The list is read at most once every six hours and kept across restarts. `Plugins: check for updates` in the
command palette — or `/plugin-updates` — forces a fresh read, which is the only way to ask again while the
pill is invisible.

## Testing

`OC_PLUGIN_UPDATES_DEV=outdated|fail|slow` fakes the states a healthy machine cannot reach: a registry with
updates behind it, a failing update, a slow one. Unset, it does nothing.

## Not covered

The version the plugin would become. `Plugin.Info` carries the installed `version` and `outdated: true`,
not the target — `opencode plugin check` does not know it either. Getting it would cost one registry call
per package.
