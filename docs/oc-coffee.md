# oc-coffee — the record

Keeps the Mac awake while the agent works: the port of pi's `pi-coffee`. The operative summary is
in the AGENTS index; this is the record.

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

Cumulative, and the assertion is held **only while a turn is active**: opened by `session.step.started`,
closed by the step that ends with anything but `tool-calls` — a step finishing in `tool-calls` means its
tools run next, so the turn is not over. Nothing is timed, which is exactly what lets a command run for a
minute without the cup dropping under it. `session.deleted` / `session.archived` also clear the session,
so a removed one cannot leave its ID behind.

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
Between turns the Mac sleeps normally, which is the point. Raising the level mid-run respawns the child
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

The counter is over **all** sessions, subagents included: the assertion is machine-wide, so one session
finishing must not put the Mac back to sleep while another works.

The state is **one per process, not one per location**. The server instantiates a plugin once for every
open location — two projects mean two instances — and they do not share module scope, so a state kept in
the setup closure would be two counters and two `caffeinate` children (measured 2026-10-27: that is
exactly what happened, one child per location, and a level change that only reached one of them). The
machine therefore hangs off `globalThis` behind a symbol: the first instance starts it, the others answer
from it, and the child is reaped at start so a plugin that is gone cannot leave one holding.

## The desktop half

A `ComposerPill`, `order` 5 — **first**, as `oc-coffee` is first in `opencode.jsonc`: the pills sort by
that number, not by load order, so the number is the only way to keep the desktop's row in the order the
terminal's footer has. Git takes 10 and the budget 15. The capsule is the level, the four rows are the
levels, and the one set carries a **green** `check` — green because that row is the one in force, the
same reading the capsule's green icon gives. The `detail` of each row is the `caffeinate` command it
means. `tone` colours the icon only, so the mark is a `monitor` that turns green while the assertion is
up: the badge's rule on a surface that has no footer.

The icon is a stand-in. The app's set has no cup, and `monitor` is the closest thing to "keep this
awake". An icon name that the app does not have draws a `plus` **without an error** — `tsc` accepts
every name in the SDK's union, and the union is wider than the drawing set — so the name is written once,
in one constant, and confirmed by eye.

Both halves read the same `coffee.snapshot` and write the same `coffee.set`, over `rpc.ts`; neither
decides whether the Mac is awake. Two traps, both about this plugin already existing: its new
`./gui-experimental` is resolved only after `opencode service restart`, and a rebuilt bundle does not
always reach a window that is already open — reloading the window is the fix for that one, not the
service.

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

- `/coffee` — the menu of the four levels (`ui.dialog.select`, the active one marked as `current`)
- `/coffee <level>`
- `/coffee status` — the level, the flags and whether the assertion is up

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
Published as `@rizal72/oc-coffee@0.1.0` on 2026-10-22, `0.1.1` on 2026-10-25 with the compiled TUI half
(`docs/publishing.md`); procedure in `docs/publishing.md`.
