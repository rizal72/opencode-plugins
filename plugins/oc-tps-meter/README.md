# oc-tps-meter

Tokens per second, step by step: how fast each answer in the session came, in a panel of the desktop app.
A bar per step — grouped when the session has more steps than the chart has room for — the model behind it,
and what the session spent in tokens.

## Install

Not on npm yet, so it is installed by hand — one absolute path in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["/Users/riccardosallusti/Documents/_PROGETTI/opencode-plugins/plugins/oc-tps-meter"]
```

## GUI

A tab in the session's side panel: the `+` menu beside the tabs, the command palette, or `/tps`. It opens
360 px wide every time; drag it wider when a model name needs the room.

Top to bottom: the speed of the last step it could measure, with the model that produced it and the wait for
the first token; the histogram, one bar per step and a median when the steps do not fit, newest on the right, a
dashed line at the median and one at the peak, and a gap where a step could not be measured — pointing at a
bar names its model, its speed and its time; a pair of lines per model with how many of its steps were
measured, its median and its peak; and the totals, cache included.

## What it leaves out

No live speed: a step counts once it has finished, so nothing moves while a reply is streaming. No subagents:
they run in their own session. No cost and no quota — the app's own header shows what the session cost, and
[`oc-budget`](../oc-budget/README.md) shows what is left to spend. No history: the session on screen is the
only thing it measures.

## How it works

It reads the session's own messages through the app every two seconds while the tab is open, and measures each
step between its first token and the end of the stream. Nothing is stored, nothing leaves the machine. The
measurement, its thresholds and the traps behind it: [`docs/oc-tps-meter.md`](../../docs/oc-tps-meter.md).

Requires OpenCode v2. TypeScript, no server half, no runtime dependencies.
