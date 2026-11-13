# oc-tps-meter — the record

Tokens per second, per step, in a side panel: one bar per closed step of the session on screen — grouped into
a median when the session has more steps than the chart has columns — the model behind each bar, and the totals
around them. **Not published**: it is installed from this repository by
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
- `tps = tokens / ((streamed − firstToken) / 1000)` — the decode window, so the wait for the first token is
  not in it
- `ttft = firstToken − created`
- measured only when both instants exist, `tokens >= 20` and the window is `>= 200` ms; anything else is a
  **gap**, never a zero
- the figure is the **median** of the measured steps, because one slow step must not move it
- cache hit is `cache.read / (input + cache.read + cache.write)`

`completed` marks a **closed** step and is never a denominator. The two roles are different: a message still
streaming already has `firstToken`, so it would enter the histogram and change on every poll; and
`completed` carries post-stream bookkeeping, so using it as the window's end understates the rate. This panel
reads the window from the message's own two instants and has **no fallback**: a message without `streamed` is
a gap, which is 331 of the assistant rows on this machine on 2026-11-13, counted with `select data from
session_message where type = 'assistant'` in `$XDG_DATA_HOME/opencode/opencode.db`, read-only. Whether a
fallback is worth having, and what it costs in accuracy, is the question
[`oc-models-pro`](oc-models-pro.md) answers — it measures the same quantity and keeps one.

The same measurement lives in `oc-models-pro/tps.ts`; the two are separate copies on purpose, because a
plugin package has no runtime to share and a shared one would make one plugin depend on the other being
installed.

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
- **A bar never mixes two models.** A drawing column that would hold a model switch is cut at the switch.
  Before that rule the detail line read `2 models` over a wrapped list of names, which at 360 px is unreadable;
  two short bars say more.
- **Buckets follow step order, not time.** Above the drawing's column count the steps are grouped by count,
  so the axis is exact at its two ends and approximate in between. Deliberate: the alternative is a
  horizontally scrolling chart, and in this width a bar the user has to hunt for is worse than a thin one.
- **The revert cut needs every message type.** `session.revert.messageID` points at a message that may be a
  user one, so reading `type: "assistant"` only would never find the boundary. Reading every type costs steps
  per page, since the cap is on messages: 2,000 of them, newest first, `truncated` when it stops there.
- **A bucket's `1 step` is singular** in the detail line and in `by model`; the panel is read, not skimmed.

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
