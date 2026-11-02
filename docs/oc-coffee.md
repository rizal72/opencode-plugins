# oc-coffee — the record

Keeps the Mac awake while the agent works: the port of pi's `pi-coffee`. The operative summary is
in the README's plugin table; this is the record.

Config: none of ours. The level is a preference the **server** persists (`ctx.storage`, key
`coffee.level`), which replaces pi's `~/.pi/agent/pi-coffee.json` — one less file to keep. The TUI's own
store is no longer written.

## The four levels

| level | caffeinate |
|---|---|
| `off` | nothing spawned |
| `idle` | `-i` |
| `display` | `-i -d` |
| `system` | `-i -d -s -u` |

Cumulative, and the assertion is held **while there is work**: opened by `session.step.started`, closed by
the step that ends with anything but `tool-calls` — a step finishing in `tool-calls` means its tools run
next, so the turn is not over. Nothing is timed, which is exactly what lets a command run for a minute
without the cup dropping under it.

A command that outlives its turn is **not on that stream at all**. Measured 2026-11-03: a background loop
for 90 s emitted no `session.shell.*` event, and the cup went out within 2 s with the process still alive —
the turn was over, so `running` was 0. The host answers the question itself: the `experimental.idle` hook
reports the background work still going when a session goes idle (`SessionIdleBackground`, a `shell` with
its `shellID`), and runs again when that work ends. So `shells` is a map of session → its live shells,
**replaced** on every report rather than merged: the report is the whole picture, so a shell missing from it
has ended. Only the jobs the session **owns** are filed: a descendant's shell is listed for information
only, its end wakes the descendant and not the ancestor, so an entry under the ancestor would never be
replaced. The count in the popover is turns plus commands — a session once for its turn, each shell once.

Two paths are **not** covered, and the reason is in the hook's own contract: it does not run after an
interruption, a failure, or control-only work, so a background command started in a turn that is then
abandoned holds nothing; and a shell whose session is gone before any further idle holds nothing after the
`session.deleted` / `session.archived` cleanup below, which now clears `shells` too.

The same contract has a third edge, in the other direction: a report is replaced only by a **successful**
idle, so if the wake turn that follows a command's end is interrupted or fails, the entry it would have
replaced stands and the child outlives the command until that session next goes idle cleanly. Erring toward
holding is the choice this plugin makes everywhere — a Mac awake for nothing wastes battery, a Mac asleep
under a running command loses work.

`session.deleted` / `session.archived` also clear the session and its shells, so a removed one cannot leave
its ID behind holding the child for ever.

**The subscription is a loop, not one `for await`.** A stream can end while the process lives, and a
single hiccup used to stop the cup until the next restart with nothing written anywhere: measured
2026-10-27, 36 s of continuous work with `held: false` and no `caffeinate` process, while the same window
on the bus carried `session.step.started`. The loop resubscribes with a backoff, 1 s doubling to 30 s, and
writes one line when the stream ends.

**The event names changed under this plugin** (measured 2026-10-27): the host no longer emits
`session.execution.*` — a 45 s window on the bus carried `session.step.*` and `session.tool.*` and not
one `execution` event — so the cup stopped engaging with no error anywhere. The old names are still
watched, and the tool events are watched too, because the names that say "the agent is working" have
already changed once.
Between turns, with nothing else running, the Mac sleeps normally, which is the point. Raising the level mid-run respawns the child
with the new flags, which is exactly when it is wanted: the Mac is dozing now, not later.

`-w <pid>` binds the child to the **server** process, so the assertion dies with the server however it
exits, SIGKILL included: a crash can never leave the machine awake for ever.

## Why the server owns it

In pi the assertion lives in the process that does the work, and in OpenCode that process is the
server — the one process every client talks to. A level held by each client would be two answers to one
machine-wide question, and two `caffeinate` children; so the level, the execution counter and the child
live in the server half, and `tui.tsx` and `gui.tsx` are two views of one answer.

This was not the first design. Measured 2026-10-16, the server's `ctx.event.subscribe()` was taken to
carry catalogue events only — no `session.execution.*`, no server-side running state — which put the cup
in the TUI and made closing it mid-run drop the assertion. Re-measured 2026-10-27 on 2.2.0, with the
desktop in sight: **both edges arrive**, and `pmset -g assertions` names the child the server spawned as
asserting on behalf of the server's pid. The older note is obsolete. The events were in the API's own
catalogue all along, which is where to look first next time.

**A reload replaces the setup, not the machine.** The object on `Symbol.for("oc-coffee.machine")` was
built by the code that first loaded, so a plugin reload leaves the old object in place: new `setup`, old
machine, and any member the old one did not have is `undefined`. Measured 2026-11-03, adding `setBackground`
threw exactly that. The hook checks for the member and returns instead of failing; making the change take
effect is what a server restart is for.

The counter is over **all** sessions, subagents included: the assertion is machine-wide, so one session
finishing must not put the Mac back to sleep while another works.

The state is **one per process, not one per location**. The server instantiates a plugin once for every
open location — two projects mean two instances — and they do not share module scope, so a state kept in
the setup closure would be two counters and two `caffeinate` children (measured 2026-10-27: that is
exactly what happened, one child per location, and a level change that only reached one of them). The
machine therefore hangs off `globalThis` behind a symbol: the first instance starts it, the others answer
from it, and the child is reaped at start so a plugin that is gone cannot leave one holding.

## The desktop half

A `session.header` slot, `order` 12 — **after** the budget's figure (11) and before the app's actions (20).
It sits with the app's own system facts, the context ring and the cost, because that is what it is: whether
this machine is being kept awake, not a setting of the conversation in front of you. Ponytail's pill stays
above the composer for the opposite reason — its level is a control you change on purpose, and a pill is
one click where a header popover is two.

The mark is the cup the terminal draws, not an imitation: **Material Design Icons' `coffee-outline`**
(U+F06CA, Apache-2.0), the same glyph the badge prints, embedded as its published path at `viewBox 24` and
coloured through `fill`. A `ComposerPill` could only choose from the app's icon set, which has no cup — the
old half fell back to `monitor` — while a slot draws its own markup. It is lit in the success colour while
`caffeinate` is up and inherits the faint header colour otherwise; the level is written beside it, and
`compact` leaves the cup alone.

The four levels live in the popover, which is `header-menu.tsx`, lifted as it stands from `oc-budget`: the
open state is ours, so a second click on the cup closes what the first opened, which the platform's
`popover="auto"` cannot do. The row in force carries a tick in the same success colour — drawn here rather
than taken from `ctx.ui.Icon`, because the SDK's icon union is wider than the set the app draws and an
absent name shows a `plus` with no error — and each row's detail is the `caffeinate` command it means.
Picking closes the panel and writes the level.

Both halves read the same `coffee.snapshot` and write the same `coffee.set`, over `rpc.ts`; neither
decides whether the Mac is awake. One trap, about this plugin already existing: its new
`./gui-experimental` is resolved only after `opencode service restart` (`docs/gui-plugins.md`, *Traps* —
a rebuilt bundle, once the half is known, reaches the open windows on its own).

## The badge

`󰛊 <level>` in `prompt.footer.status`, **always visible** — `off` included: the badge is the
setting, and seeing `off` is how you know the plugin is loaded and deliberately doing nothing.
(pi hides it when the level is `off`; the owner asked for the name.) Only the **cup** turns green
while the assertion is up, so the state is one mark and the level keeps the footer's colour and
stays legible.

The cup's colour is a Solid **signal** filled by a read, not a local variable: the assertion changes in
the server now, so the badge repaints from a poll every two seconds — short on purpose, because a cup
that lights two seconds late lies while you watch it.

**Position**: `oc-coffee` is listed **first** in the `plugins` array, so the badge opens the
footer row — `󰛊 display  󰅐 GO 71%  … 409.9K/1.0M (41%)`. In the middle, between the wallet and the
context, it reads as if it belonged to either; last would land it after the key hints.

## The command

- `/coffee` — the menu of the four levels (`ui.dialog.select`). It **is** the status: the level in force is
  marked as `current`, and the footer's cup says whether it is holding right now, so there is no separate
  `status` command. Each row is a one-word title and a sentence about the Mac, because a row is one line and
  a narrow terminal cuts it (`docs/tui-plugins.md`); the `caffeinate` flags are not here. A `Status` row sits
  below a `category` of its own and carries the live sentence — `nothing to keep awake right now`, `the Mac
  is being kept awake now`, or `the Mac sleeps as usual` — and picking it only closes the menu.
- `/coffee <level>` — the same change without the menu; the toast that follows says what it is doing to the
  Mac: `Coffee: display — the Mac is being kept awake now`, or `nothing to keep awake right now`, or
  `Coffee: off — the Mac sleeps as usual`. No flag text and no count there: a toast does not update, so
  anything that moves would be stale while it is read.

The level is the only thing persisted; nothing else is state.

## Limits

`caffeinate` reaches idle and display sleep, and (at `system`) system sleep on AC. **Lid close and
an explicit sleep are out of its reach at every level** — only `pmset` reaches those. macOS only:
on another platform the plugin stays loaded and never engages.

Two costs of the one-machine design, both accepted: the counter is **in memory**, so it is born at zero
— right at a server start, wrong after a plugin reload mid-run, where it stays at zero until the next
`started`; and the machine is **never torn down**, because it belongs to the process and not to a
location, so disabling the plugin leaves its child (and its assertion) until the server restarts.

## Publishing

Publishable as it stands: it drives `caffeinate`, keeps no paths of its own and holds nothing personal.
Published as `@rizal72/oc-coffee`; procedure in `docs/publishing.md`.
