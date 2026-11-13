# oc-tps-meter — the record

Tokens per second, per step, in a side panel: one bar per step of the session on screen — the model behind each
bar, and the totals around them. **Not published**: it is installed from this repository by
path, `~/.config/opencode/opencode.jsonc` -> `plugins: [...]`.

## A GUI half and nothing else

No `index.ts`, no `rpc.ts`, no SQLite, no server half at all. That is the difference from
[`oc-models-pro`](oc-models-pro.md), which reads the host's database to find a rate **per model across the
whole machine**: this panel answers about **one session**, and the session's own client already carries
everything — `message.list` returns each message with `time.created`, `time.firstToken`, `time.streamed`,
`time.completed`, its tokens and its model. The server half would have been a second way to compute
the same figure, and the class of failures that comes with it (an `undefined` in an rpc answer, a poll that
blanks the panel on a bad night).

`metrics.ts` is pure and importless, so `node --test` tests exactly what the panel runs.

## The metric

Per assistant message, called a step:

- `tokens = tokens.output + tokens.reasoning`
- `tps = tokens / ((streamed − started) / 1000)` — the decode window, so the wait for the first token is
  not in it
- `ttft = started − created`
- `started` is `time.firstToken`, and for the messages recorded **before that field existed**, the time of the
  first **reasoning** part. Reasoning only: a tool part's time is when the call begins, which is after the
  model has generated, so using it collapses the window — on real rows it turned 365 tokens into 1388 t/s.
  Text parts carry no time, so an old text-only or tool-only message stays unmeasured.
- measured only when `started` and `streamed` exist, `tokens >= 20` and the window is `>= 200` ms; anything
  else is a **gap**, never a zero
- the figure is the **median** of the measured steps, because one slow step must not move it
- cache hit is `cache.read / (input + cache.read + cache.write)`

The fallback is what makes an older session readable at all. Measured on one session started the day before
`firstToken` appeared (2026-11-13): 853 assistant steps, `firstToken` on the newest 113 and on no other. Of the
740 older ones, 484 carry a timed reasoning part, 206 only a timed tool part, and 50 nothing timed — so the
fallback recovers 483 of them, and the tool-only ones stay gaps rather than becoming wrong numbers. Its cost:
the reasoning part's time is 1–2 ms after the first token on most rows, more than 2 ms on 37 of 364 compared
ones and up to 119 ms, which reads up to **17.8% fast** on that row. The median of a session does not move; a
single old bar can.

`completed` marks a **closed** step and is never a denominator. The two roles are different: a message still
streaming already has `firstToken`, so it would enter the histogram and change on every poll; and
`completed` carries post-stream bookkeeping, so using it as the window's end understates the rate. A message
without `streamed` is a gap — 331 of the assistant rows on this machine on 2026-11-13, counted with
`select data from session_message where type = 'assistant'` in `$XDG_DATA_HOME/opencode/opencode.db`,
read-only — and nothing can measure it, because the end of the stream is the one instant with no substitute.

The same measurement lives in `oc-models-pro/tps.ts`; the two are separate copies on purpose, because a plugin
package has no runtime to share and a shared one would make one plugin depend on the other being installed.
That copy still accepts **any** timed part in its fallback, tool parts included, which reads those rows high —
an open defect recorded in [`oc-models-pro`](oc-models-pro.md), *Speed, measured*.

## Reading the session

Every two seconds while the tab is open, and nothing while it is closed: the app pushes no change event for
message data, so the panel asks on a clock. A step enters the panel only once its stream is closed, which is
why nothing moves while a reply is arriving.

Two states are drawn instead of hidden:

- a read that fails keeps the figures it already has and marks them with their age, because a panel that
  empties itself on one bad poll is worse than an old number;
- a revert whose message sits older than the 2,000-message window cannot be cut, so the panel says that undone
  steps may be counted, rather than trusting a cut it could not make.

Nothing is stored: no file, no cache, no state of ours. Reopening the panel recomputes everything from the
session, and a session with more than 2,000 messages loses the oldest end of its history, not the newest.

## Decisions, and what they cost

| decision | why | cost |
|---|---|---|
| no live rate | needs `session.step.*` and `text.delta` subscriptions, a 60 s ring of samples and a learned characters-per-token factor: about half the plugin, for a number that moves while the model thinks | none today; `firstToken`/`streamed` are the measured figures |
| no subagents | a subagent runs in a **child session** with its own id, so its steps are not in the routed session's messages at all | a tree means one extra listing plus one read per child |
| no cost figure | the session header already shows the session's cost, and under Go it is `$0` | nothing stored for it: the field was summed and never drawn, so it is not kept at all |
| no quota, no usage | that is [`oc-budget`](oc-budget.md)'s, and it is the only part that needs a credential and the network | zero network calls |
| bars, not a line | a histogram reads a distribution at a glance; the line exists in the reference plugin only for the live 60 s | none |

## Traps found while building it

- **A cursor cannot travel beside `order`.** `message.list` rejects the pair — in the app the panel showed
  *"Cursor cannot be combined with order"* — because the cursor carries the direction it was cut in. `order`
  belongs to the first request only; the pages after it pass the cursor alone. Measured 2026-11-13.
- **A dragged panel width is not written to the store here.** `Panel.width` is supposed to put the panel on
  the app's `panelWidths` map, app-wide, and the docs say a drag replaces it. After a manual resize the store
  still held the declared value (`{"oc-tps-meter:tps": 340}`, read in
  `~/Library/Application Support/ai.opencode.desktop/drafts.sqlite`, `state`/`layout`, 2026-11-13), so the
  drag lived only in that view. The half therefore re-applies its width at mount with
  `layout.side.resize("tps", …)` — the per-panel call, which does write — and the width is the same at every
  open. That is the behaviour the owner asked for, reached from the other side: the width is a constant, the
  drag is a temporary wish.
- **A bar never mixes two models.** One bar is one step, and a step has one model, so the question cannot
  arise: an earlier version grouped steps into columns and one column could straddle a model switch, which read
  as `2 models` over a wrapped list of names at 360 px.
- **One bar per step, and the chart scrolls.** Grouping was the earlier answer to a long session — the axis
  then was exact at its two ends and approximate in between — and panning replaced it: a step is a fixed 4 px
  (3 px bar, 1 px gap), the drawing is as wide as the session, and a wrapper scrolls sideways only. Vertical
  gestures stay with the panel. The hint between the two times says which way there is more, and says nothing
  when the whole session fits.
- **The scale is the peak, with one fence.** Scaling to the peak alone is what every bar wants — 460 next to 250
  next to 100 reads as itself — but a single freak step then flattens the rest. So the scale is
  `min(peak, 2 × p95)`: normally that is the peak exactly, and only a bar more than twice the 95th percentile is
  cut at the top edge with a bright cap, keeping its true figure in the detail line while the peak stays in the
  counts. The earlier rule scaled to the p95 itself and cut the top 5% — on a real session that was twenty bars
  with the same cap, which hid exactly the fast steps the chart exists to show.
- **The revert cut needs every message type.** `session.revert.messageID` points at a message that may be a
  user one, so reading `type: "assistant"` only would never find the boundary. Reading every type costs steps
  per page, since the cap is on messages: 2,000 of them, newest first, `truncated` when it stops there.
- **An unmeasured step still owns its 4 px**, and its detail line says it was not measured: a gap in the
  histogram would otherwise read the same as a session that did nothing for a while.

## Where it lives in the window

`Panel "tps"`, side region, declared width 360, `closable: "hover"` — a thing you look at, not a dashboard that
must always be there. Opened from the session panel's menu (`TPS Meter`), the palette (`TPS Meter`), or
`/tps`. The app's own header already draws the context ring, the token count and the session cost, so this
panel adds the dimension they lack.

## Reading the figures

At the time of writing, on this machine, DeepSeek's native provider measures a median around 194 t/s with a
peak of 460, against around 106 t/s for the same models through Go — which is what the `by model` block is
for. Those are a measurement of a route, not a catalogue number: the same model differs by provider, which is
the same reason `oc-models-pro` measures its own `tok/s` instead of borrowing one.
