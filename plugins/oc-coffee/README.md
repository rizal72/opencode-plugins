# @rizal72/oc-coffee

Keeps the Mac awake while the agent is working, and lets it sleep between turns.

A cup in the prompt footer shows the state — green while a run is active — and `/coffee` cycles the
level.

**macOS only**: it drives `caffeinate`. Elsewhere the plugin loads and the badge stays off.

## Install

```sh
opencode plugin add @rizal72/oc-coffee
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-coffee"]
```

## Use

| level | what is blocked |
|---|---|
| `off` | nothing |
| `idle` | idle sleep — `caffeinate -i` |
| `display` | idle and display sleep — `-i -d` |
| `system` | everything, and the user is declared active — `-i -d -s -u` |

The assertion lives only while a run is active: it is engaged when the agent starts and released when
it succeeds, fails or is interrupted. It is bound to the TUI's own process (`caffeinate -w`), so it
dies with the window however the window closes — a closed terminal cannot leave the machine awake.

Requires OpenCode v2 and macOS. TypeScript, no build step, no runtime dependencies.
