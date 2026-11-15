# oc-tps-meter

Tokens per second, step by step: how fast each answer in the session came, in a panel of the desktop app.
A bar per step — the session scrolls sideways when it outgrows the panel — the model behind it,
and what the session spent in tokens.

## Install

```sh
opencode plugin add @rizal72/oc-tps-meter
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-tps-meter"]
```

## Update

V2 checks package plugins at startup and never applies the update, so a package only moves when you ask:

```sh
opencode plugin check     # which of the installed packages are behind
opencode plugin update    # apply them, and let the server reload
```

Or install [`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates): the
count appears in a pill above the composer, with the update one click away.

## GUI

The last measured step's `tok/s` sits in the session header — the element draws it as `t/s` — and a click
shows this panel or hides it, leaving its tab in the strip so the next click brings the same view back.

The gauge sits in the header beside the app's own context ring and cost, with the speed next to it in
`t/s`, faint like the app's own figures and white under the pointer. It turns red when that step waited more than
ten seconds for its first token, because that wait, not the speed, is what says you are queued — and it is
the only thing that breaks the grey at rest. Hovering names the speed in `tok/s` and, on a second line, the
model it came from; when the header runs out of room only the glyph stays, and the hint keeps both.

The `tok/s` the app prints at the end of a turn is that turn's average, and it only appears once the turn
closes. This meter measures `tok/s` for every step, so a slow step and its wait stay visible instead of being
averaged away.

A tab in the session's side panel: the `+` menu beside the tabs, the command palette, or `/tps`. It opens
360 px wide every time; drag it wider when a model name needs the room.

Top to bottom: the speed of the last step it could measure, with the model that produced it and the wait for
the first token; the histogram, one bar per step, newest on the right, a dashed line at the median and one at
the top of the drawing, where the tallest bar ends — and, when the peak is beyond the scale, a bright cap on
the bars that cross it — and, where a step could not be measured, the same 2 px mark at the baseline instead of a
bar. Pointing at one turns the block at the
top into that step, its time in place of the label. Then a pair of lines per model with how many of its steps
were measured, its median and its peak; and the totals, cache included.

The chart scrolls sideways: two fingers on the trackpad, shift and the wheel, or the scrollbar, and the small
hint between the two times says which way there is more. A time carries its date once it is not today's, at
the ends of the axis and in the label alike. A bar turns red when that step waited more than ten seconds for
its first token — and the wait in the block above turns red too — because that wait, not the speed, is what
says you are queued. Bar heights follow the fastest step — only a step more than twice the 95th percentile is
cut at the top edge, and it keeps its real figure in the block above when it is pointed at — so one exceptional
step does not flatten the rest.

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
