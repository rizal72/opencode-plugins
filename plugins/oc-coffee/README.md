# @rizal72/oc-coffee

Keeps the Mac awake while the agent is working, and lets it sleep between turns.

**macOS only**: it drives `caffeinate`. Elsewhere the plugin loads and the cup never lights.

## Install

```sh
opencode plugin add @rizal72/oc-coffee
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-coffee"]
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

A cup in the prompt footer, green while a run is active and grey when idle. `/coffee` opens the menu of
the four levels with the one in force marked, and `/coffee display` sets one without the menu.

## GUI

The cup sits in the session header, beside the app's own context ring and cost: lit while the machine is
kept awake, the level written next to it, and the four levels in the panel behind a click. Picking one
there moves the same level the terminal shows, because both ask the server rather than their own screen.

## How it works

| level | what is blocked |
|---|---|
| `off` | nothing |
| `idle` | idle sleep — `caffeinate -i` |
| `display` | idle and display sleep — `-i -d` |
| `system` | everything, and the user is declared active — `-i -d -s -u` |

The level and the child belong to the server half: one `caffeinate` runs, however many windows are open and
whichever client changed it. The keep-awake exists only while there is work — the agent's run, and any
command still running after the run has finished — and the child is bound to the server's process
(`caffeinate -w`), so it cannot outlive the thing that owns it. A closed window is not the signal; the end
of the work is. The host reports that leftover work when a session goes idle, which it does not after an
interruption or a failure: a command from an abandoned turn holds nothing, and a report is replaced only by
a successful one, so the keep-awake can outlive a command until that session next goes idle cleanly.

Requires OpenCode v2 and macOS. TypeScript, no build step, no runtime dependencies.
