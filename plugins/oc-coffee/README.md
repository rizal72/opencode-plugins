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

## TUI

A cup in the prompt footer, green while a run is active and grey when idle. `/coffee` alone opens the
menu, `/coffee display` sets a level, `/coffee status` reports.

## GUI

The cup becomes a pill above the composer: the level as the capsule, the four levels as its rows. Picking
one there moves the same level the terminal shows, because both ask the server rather than their own
screen.

## How it works

| level | what is blocked |
|---|---|
| `off` | nothing |
| `idle` | idle sleep — `caffeinate -i` |
| `display` | idle and display sleep — `-i -d` |
| `system` | everything, and the user is declared active — `-i -d -s -u` |

The level and the child belong to the server half: one `caffeinate` runs, however many windows are open and
whichever client changed it. The assertion exists only while a run is active — engaged when the agent
starts, released when it succeeds, fails or is interrupted — and the child is bound to the server's
process (`caffeinate -w`), so it cannot outlive the thing that owns it. A closed window is not the signal;
the end of the run is.

Requires OpenCode v2 and macOS. TypeScript, no build step, no runtime dependencies.
