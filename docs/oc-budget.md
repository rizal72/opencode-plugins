# oc-budget — the record

One widget for the active provider's budget, ported from pi-budget but reading OpenCode's own
credentials instead of a file of ours. The operative summary is the README's plugin table; this is the
record.

Config: none of its own. The only thing to configure is its line in `~/.config/opencode/opencode.jsonc` — a
package name now that it is published, a path while working on the checkout — and the credentials, which live
in OpenCode's integration store (`opencode auth login`).

Its sidebar block reaches the top with `prepend`, like the other three of ours; the mechanism and the
measurement are in `docs/sidebar.md`.

## Where it lives

| file | half |
|---|---|
| `plugins/oc-budget/index.ts` | **server**: resolves credentials, reads the four wallets, caches, registers the RPC |
| `plugins/oc-budget/tui.tsx` | **TUI**: two slots and `/budget`, nothing else |
| `plugins/oc-budget/gui.tsx` | **GUI**: the figure in the session header and its popover, over the same contract |
| `plugins/oc-budget/rpc.ts` | the contract all three halves import |
| `plugins/oc-budget/budget.ts` | the thresholds, `payingWallet`, `bindingWindow` and `windowPercent`, shared by both surfaces |
| `plugins/oc-budget/peak.ts` | DeepSeek's two tariffs, shared by both surfaces; `--self-check` |

The loader does **not** read `package.json` for a directory target: it looks for files named
`server`/`index`, `tui`, `rpc` at the package root (`PackageModule.resolve`). Entries therefore stay at the
root, and `exports` is what a published package resolves by name.

## Two halves, one contract

The TUI cannot resolve a credential (there is no HTTP endpoint that returns a secret), and the server
cannot render. So the server does the reading and the TUI the drawing, joined by RPC `budget.snapshot`
(`rpc.ts`).

- Server: one collection at a time (`inFlight`), reused for 5 min; `force: true` bypasses the cache and
  never joins a collection that started before it, so a credential switch always reads the new account.
- TUI: polls every 5 min, and forces a re-read on a model change and on any `credential.*` /
  `integration.*` event — so an account switch lands at once instead of waiting for the poll.
- Every fetch is failure-tolerant, and it keeps two things apart: a wallet with **no connection** is left
  out of the snapshot, while a dead endpoint or a bad credential on a connection that exists becomes an
  `error` string on that wallet's branch and the others still report.

## Credentials

Resolved from OpenCode's integration store with `ctx.integration.connection.active(id)` +
`connection.resolve(connection)`. The value is `{type:"key", key}` or `{type:"oauth", access, expires}`.
Nothing is read from a file, and nothing is stored by the plugin — unlike pi-budget, which kept its own
`zen-billing.json` with a lock and a token rotation because pi had nothing.

| integration | method | gives |
|---|---|---|
| `opencode-go` | key | `GO %` |
| `deepseek` | key | `DS $` |
| `openrouter` | key | `OR $` |
| `opencode` (OpenCode Console) | oauth | `OC $` |

An integration can hold **several credentials with one active**, which is what makes account switching
free: `connection.active` follows the active one, so the widget never needs to know there is more than
one account.

## The four wallets

| state | what it shows | source | thresholds |
|---|---|---|---|
| `GO nn%` | the subscription pays | console `go/status` meters (fallback `zen/go/v1/usage`) | the colour is the window that comes first: green < 90, yellow from 90, red at 100 (spent) |
| `OC $x.xx` | the pay-per-use credit pays | console `billing/status`, `availableMicroCents` | green > $5, yellow ≤ $5 (the console's auto-recharge), red at 0 |
| `DS $x.xx` | native DeepSeek wallet | `GET api.deepseek.com/user/balance` | green > $2, yellow ≤ $2, red at 0 |
| `OR $x.xx` | OpenRouter credits | `GET openrouter.ai/api/v1/credits` (+ `/key`) | green > $5, yellow ≤ $5, red at 0 |

The three money wallets carry **two forms, both in `WALLET_NAME` in `budget.ts`**: the sigla where a name *is*
the row — `DS`, `OR`, `OC`, in the header figure and the footer — and the full name where there is a column to
spare — `DeepSeek`, `OpenRouter`, `OC credits`, in the popover and the sidebar block. Go stays short
everywhere, because it heads its own block and carries the bars. `OC` is not invented here:
`oc-models-pro/tags.ts` already reserves it for the `opencode` provider — the same account whose credits this
wallet reads — and `GO` pairs with it. The sigla is defined once, so a rename lands in one place.

The third one says `credits` and not `Zen`: "OpenCode Zen" is a retired name — `opencode.ai/zen` answers `302`
to `/console/models` and `v2/docs/zen` is a `404` (measured 2026-11-02), while the current documentation calls
the figure *prepaid credits that cover the whole workspace*. The word survives as this record's own name for
the wallet, and in the vendor's identifiers — the `opencode-zen` provider and `OPENCODE_ZEN_API_KEY` — which is
why `zen` stays the key everywhere in the code and in this document.

**A wallet with no connection never reaches the window.** The server leaves it out of the snapshot
rather than filling it with an error, so the sidebar's block, the wallet sections of `/budget` and the
header figure draw only what the account has. One line still names a wallet the snapshot lacks, because
it talks about the *model* rather than the wallet: `/budget`'s first line — a Go model on an account with
no Go connection still says so, and prints no figure. The footer has nothing to say about that wallet and
hides instead, where a dash would claim a reading. A connection that exists but whose read failed is a
different thing and keeps its line with the reason: an absence is silent, a fault is said. One consequence
worth knowing:

- **Go is hidden when neither path can read it.** The Console session and a Go key are each enough on
  their own; when the Console is absent, or its read fails, and no Go key resolves, GO is left out — a
  workspace without the subscription answers a failed read exactly like a broken endpoint, and reporting
  that would put a permanent error under every free account. A Console connection that exists but cannot
  produce a token is a fault and is reported, and so is a failed read when a Go key is present.

Which wallet *pays* is decided by each half from the model of its own surface — the composer's in the
window, the session's in the terminal — because the two pickers disagree on purpose
(`docs/gui-plugins.md`, *A model pick belongs to a surface, not to the session*): `deepseek` → DS,
`openrouter` → OR, `opencode`/`opencode-zen` → OC, `opencode-go` → GO, always. **Reaching any of the three
windows stops the subscription's requests**, and whether they continue on the prepaid balance depends on the
Console's **Extra Usage** toggle — off by default on Go and Go Plus, on for Go Teams — which the snapshot
cannot read. The earlier rule ("the gateway falls back to OC once the *month* is `rate-limited`") was wrong
twice: the wrong window, and a fallback taken for granted. Naming the credits there would describe the wrong
payer exactly when the reader most needs the truth, so a spent window is red under GO and OC keeps its own
line.

The sidebar prints a bar for each of Go's three windows — `5h ████████████████████ 2%` — with `↻ 2h 30m` on the
row below, left-aligned directly under the bar, and a `GO` heading whose colour is the window that stops the
subscription first (`bindingWindow` in `budget.ts`). Each reset follows its own bar with no blank row, and
only the last window keeps one, which separates the block from the workspace: until 2026-11-10 there was a
row between every pair, three rows of air in a panel that had none to spare. The
month has no bar of its own any more: it had one at the top of the block and it is one of the three, so the
heading that carried it carries the alarm instead. The labels are muted, **each bar and percent is coloured
on its own value**, and the percent sits one space past the bar rather than in a padded column: it is read
with the bar, not from the edge. The bar is twenty cells — the panel is wider than the block assumed, and ten
left half of it empty. History: before 2026-10-29 the three figures shared one row and only the monthly reset
was printed; until 2026-11-08 the reset sat on the same line as its percent. The block has grown to ten lines
rather than five — the price of three bars, and the reason the row is as tight as it is.

One name, in the Go block: `workspace: go-2`, a line of its own after the windows — the label dim, the name
in the accent oc-git gives the branch, the only identity colour in a panel of state colours. A dim rule of
fixed length follows it and closes the Go block, so the wallets below read as a separate group — **28
columns**, the width of a window row (`mo`, twenty cells, the space and `100%`), so the rule underlines the
bars above it instead of stopping short of them. Fixed and not measured: the panel does not report the
sidebar's width. The workspace is not a property of the balancing wallet: it is the console session, which
governs the Go windows *and* the `OC`
balance. The **sidebar** prints it only when more than one console connection is saved; with one there is
nothing to distinguish. `/budget` prints it always, under its first line: there it is information, not a
crowded row.

The provider's authentication **is** the console connection. Measured 2026-10-26: `opencode-go` carries
`integrationID: "opencode"` and an `x-opencode-org-id` header, so a Go key decides nothing about billing
inside OpenCode.

**Two ways in, one answer.** The Go windows work with either credential alone, and console session wins:
`go/status` first, because it carries the exact meters; a Go API key next, through `zen/go/v1/usage`. The
second is not only for a machine with no console session — a session that cannot read the meters (a
workspace without the subscription answers `403`) falls through to the key instead of failing, and if both
fail the error names both. The credits have no such choice: only the console session opens billing, so
`OC` needs that connection and nothing else.

The Go percents come from `console/api/go/status`, whose `access.meters` gives the spend in micro-cents
against a known limit: the only form that can agree with the page the owner is looking at. Both sides of
that page were read, the endpoint and the bundle, because the first answer was wrong.

- the console's own rule, from its bundle: `(used*200 + limit) / (limit*2)`, i.e. **round** the percent,
  and cap it at 99 until `used >= limit` — that is the `>99% used` the page shows, and the cap keeps the
  figure from reading 100, spent, before the limit is reached;
- the public `zen/go/v1/usage` rounds **down**, so it answered `0 0 0` while the page read `1% 0% 1%`
  (measured 2026-10-26, same workspace, same minute: 1.04% / 0.42% / 0.99% of the three limits). It stays
  only as the fallback for a machine with no console session, where its integer is all there is.

One consequence, decided 2026-11-08: **a window whose status is `rate-limited` reads 100, whatever number it
carried** (`windowPercent` in `budget.ts`). The console path already sets 100 by itself; the public endpoint
rounds down and could name a stopped window at 99 or below, and a stopped window painted green while the
report called it exhausted is the kind of disagreement a reader cannot resolve. The state is the reading, and
it is the same reading for the colours, the header figure, the hover hint and the report's own bars.

Both paths are clamped to the three fields the contract allows — `status`, `percent`, `resetsAt` — before
they leave the server, and a missing `status` is derived from the percent (100 means exhausted). That is
not tidiness: `additionalProperties: false` on the window means one stray field fails serialization and
takes the whole snapshot with it, all four wallets at once, and the fallback endpoint documents its shape
nowhere.

`billing/status` answers **two** money figures, and the panel prints the one the console prints:

| field | meaning |
|---|---|
| `balanceMicroCents` | the ledger, signed: it goes under when the request that crosses the end costs more than what is left |
| `availableMicroCents` | *available credit*, the figure the console shows: the balance clamped at 0, and raised by a credit limit when the account has one |

Measured 2026-10-26 on `go-2`: `balanceMicroCents: "-5076149"` (−$0.05) with `availableMicroCents: "0"`,
and the console page reading `Available credit $0.00`. So a credit balance **can** be negative, by a few
cents of prepaid overshoot; what cannot is the spendable credit. The panel shows the spendable credit, and
`/budget` adds `(debt $0.05)` beside it when the ledger is under — the clamped figure would hide cents that
are spent money. Clamping in our code instead would have hidden the debt and stayed wrong the day a credit
limit arrives.

## The Console session is scoped to one workspace

The non-obvious part, and the reason the Zen number was wrong at first.

The console token a plugin receives is **bound to the workspace selected when the account was
connected**, and `billing/status` answers `{"_tag":"Forbidden"}` for every other workspace. So the
workspace must be read from the session — `GET /console/api/orgs/current` — and never guessed from a
name list. Measured 2026-10-16, one token each:

| login | `go` | `go-2` | `Personal` |
|---|---|---|---|
| Personal | Forbidden | Forbidden | `pay-as-you-go`, 0 |
| go | **$12.84** | Forbidden | Forbidden |

Two consequences:

- Switching which Zen wallet is read means switching the **Console account**, not a header.
- No API key opens the console, whatever its scopes: `GET /console/api/*` answers `Unauthorized` to a
  Go key, and `Forbidden` to the same key paired with an `x-org-id`. The console wants a *session*, so
  the "API key" method there expects a console service-account key, not a model key.

The money fields are micro-**cents** (1e-8 USD), fixed by the account's own invoices; cents are
rounded before the division, because `(micro / 1e8).toFixed(2)` is a cent low on values like
100500000.

## Accounts and switching

Two accounts are two credentials on two integrations (`opencode-go` for the key, `opencode` for the
console session). Switching is native:

```
opencode auth switch opencode-go "<label>"   # GO %
opencode auth switch opencode            "<label>"   # OC
```

or the TUI `/connect` dialog. The widget follows, with no restart: the switch emits
`credential.switched`, which the TUI hooks and turns into an immediate `snapshot({force:true})`.

## Peak marker

DeepSeek's peak windows, in UTC: 01:00–04:00 and 06:00–10:00, Mon–Fri; everything else is half price.
UTC is deliberate (DST-proof), and a Chinese public holiday is not encoded, so it reads as peak —
over-warning, the safe direction.

It marks a **dual-tariff model**, not "native DeepSeek": the DeepSeek ids on Go carry it too while the
subscription pays. Zen never does — its DeepSeek price is flat at the peak figure, a constant and not a
doubling.

The windows, `isPeak`, `doubles` and `nextChange` live in `peak.ts`, one definition for both surfaces
(`--self-check`). What each surface does with the flag is its own business:

- **terminal**: a red mdi trending-up glyph next to the amount and on the `GO` heading of the block. Since 2026-10-29 the
  block marks from `isPeak`, not from `doubles`: it appears on GO and DS whoever is paying, because the
  reminder not to switch *to* them is worth more than a report on the one in use. The footer keeps
  `doubles` — it shows one wallet, the one paying;
- **desktop**: `↗` at the end of the figure's label when what you are paying doubles — the footer's rule.
  In the popover, `↗` sits on the GO heading and on the `DS` line whenever the hour is peak, whether or not
  they are the ones paying: the same rule as the block. Zen and OpenRouter never carry it.

## Colours come from the theme

No hard-coded palette: the alert levels are theme tokens, passed to `fg` as the renderer's colour
objects, with a hex fallback. Each role takes the first token its theme defines, in this order:

| role | first | then | then |
|---|---|---|---|
| green | `syntax.string` | `diff.text.added` | `text.feedback.success.base` |
| red | `diff.text.removed` | `syntax.keyword` | `text.feedback.error.base` |
| yellow | `text.feedback.warning.base` | `syntax.type` | `syntax.number` |
| grey | `text.muted` | `text.faint` | — |
| heading | `text.base` | — | — |

Green and red lean on the diff pair before the feedback tokens: it is the one hue every theme
guarantees, so the alert levels read the same in a theme that knows nothing about `text.feedback.*`.
Which of these a theme actually defines is the theme's business — the list is a preference order, not
a claim about any single theme.

## The footer

The footer is only **appended to** (`append: "prompt.footer.status"`), never taken over: that row
also holds the **project folder** (clickable, opens the project picker), the **working spinner** and
the **esc** hint, and `replace: "prompt.footer"` — tried on 2026-10-16 and reverted the same day —
gave up all three for one string.

The contribution here is the **paying wallet alone**. The session's context — with the window the
percent is a percent of — is its own plugin, drawn as a **block in the sidebar**: `oc-context`
(`docs/oc-context.md`).

In that footer widget the **glyph stays neutral** and only the body — `GO 71%` — carries the state
colour, as pi does: a coloured mark beside a coloured word would be two signals for one fact. The number is
the month, unqualified, and the colour is the window that comes first (`bindingWindow`): a spent 5 hour
window turns the footer red at 7% of the month, which is the moment the reader needs to know, and the
sidebar beside it says which window.

## The report

`/budget` draws the sidebar's block as a JSX dialog — bordered, medium, centred — because the command exists
for the case the panel is hidden or not mounted. It carries what the panel drops and nothing the panel
computes differently: the payer line and the workspace always, the three windows with the same 20-cell bars
and `↻ 2h 30m` under each, the rule, the wallets with their colours, then the peak lines and the clock. Two
wallet details are the report's alone: OpenRouter's ceiling (`$3.15 of $10.00 (used $6.85)`) and Zen's
`(debt …)`; the panel shows the balance. A spent window is red with a full bar — the word `exhausted` went
when the string dialog did.

## Desktop half

The desktop has a figure where the TUI has the footer and a popover where it has the sidebar block, and
the two now say the same thing: the **figure carries the paying wallet** (`GO · 7%`, with a ring filled to
the month and drawn at the app's own geometry — a 16 px circle, 2 px stroke, so the two rings read as one
family), and the **popover is the block** — a `GO` heading, three rows of bar and percent with each
reset under its own row, the workspace, a rule, then DeepSeek, OpenRouter and OC credits.

The figure prints the **month** and keeps the month's own fill, because the three percentages are shares of
three different limits and only the month is comparable from day to day: printing the highest would hide the
month precisely while someone works hard. Its **tone**, however, is the window that comes first — the colour
says "a wall is near", the number says "how much of the plan is left" — and the hover hint names the guilty
window and its reset (`Budget · 5h 96% · reset 40m`) **when that window is not the month**: when the month is
the one at 90 or more, the hint stays the generic line, because the figure already is the month and its colour
says the rest. A spent 5 hour window therefore paints the figure red at
7%, which is the honest reading: the subscription has stopped and the month has not.

The block is the plugin's own popover, in the top layer and anchored to the figure: no host menu wraps it,
so the width and the placement a `ComposerPill` `menu` imposed no longer apply (`docs/gui-plugins.md`,
*The always-visible surfaces*, and the `menu` traps under *Traps*).

- each of the **three bars** is proportional to its own window, clamped to its track, coloured by the
  terminal's own rule — green, yellow from 90, red at 100 — and the heading takes the first of the three;
- every figure is coloured **on its own value**: the three windows, each wallet's balance, the workspace in
  the accent. The colours are the app's CSS variables (`--v2-state-fg-*`, `--v2-text-text-muted`), never
  hex: a GUI plugin has no theme API, and those tokens are the theme's own three alert levels;
- the **three windows are three groups** — label, bar and percent on one row, the countdown alone under it
  at 11px. In the **popover** the countdown is right-aligned so its end meets the bar's end, the point on
  the bar where the reset would happen, and the arrow closes it, `2h 30m ↻`; the margin that puts it there
  is 37.8px — the percent's 2.6em at 13px plus the row's 4px gap, written in pixels because this line is
  11px and its own em is a different unit. In the **sidebar and `/budget`** the arrow leads, `↻ 2h 30m`,
  left-aligned under the bar's start. Same words; each arrow sits on the edge the column is aligned to;
- **the peak `↗` marks GO and DS whoever is paying** (`isPeak`): its job is the reminder not to switch to
  them. The figure's `↗` marks only the paying model (`doubles`). Two questions, two functions — the rule
  `peak.ts` documents;
- the popover **forces a read on open** (`{ force: true }`, past the server's cache), because the tick is
  five minutes: a wallet connected or removed a minute ago would otherwise stay invisible for the rest of
  the TTL;
- the workspace is named only when the console account has peers, as the block does;
- `order` is 11: after the app's own figures in that row — the context ring, the tokens, the cost, at 10 —
  and before its actions, at 20. At 10 it would land there only by a tie, decided by which plugin
  contributed first (`docs/gui-plugins.md`, *Where a contribution lands, by layout*);
- the read goes through the **session's own server** client, like git's, and refreshes every 5 minutes. A
  provider switch forces one only on a reading older than five seconds: five covers a bounce of the catalog
  at startup, while a person who switches a workspace and comes back takes longer — measured 2026-11-01 at
  thirty seconds, where the return arrived inside the guard and showed the expired workspace's error under
  the paying one;
- **three states, never two** (`docs/gui-plugins.md`, *a pill never shows a stale value as fresh*): fresh
  as above; **stale** when the last good reading is older than two polls (10 min) — the label takes a `~`,
  the tone `warning`, the host's own `ctx.ui.Tooltip` reads `Budget · last read 12m ago`, and the popover
  opens with `stale 12m`; and **nothing read yet with a failure** — the label `budget`, icon
  `circle-exclamation`, tone `danger`, the error in the tooltip and as the popover's only text. A failed
  poll keeps the last good reading and asks again in 30 s; it does not blank the figure. Before the first
  answer it stays hidden: a fresh window is not a fault. The fourth state, an account with no provider at
  all, is the section below.

## No provider connected

An account with no wallet is a state of its own: not an error, and not nothing. It is drawn, in the lowest
voice the plugin has, because vanishing would say the plugin is not installed while it is — and because the
sidebar's heading is drawn either way, so silence there is a title with nothing under it.

| surface | what it draws |
|---|---|
| header figure | the wallet mark, the word `budget`, no tone: the same grey as the app's inactive controls, never yellow or red |
| its popover | `no provider connected`, then `opencode auth login` |
| sidebar block | the heading, then one muted line `no provider connected` |
| `prompt.footer` | nothing: that row reports the wallet that pays, and no wallet pays |
| `/budget` | `No provider connected`, then the command — a command was asked for, so it answers |

**Two silences share that figure.** The same dim mark is drawn when wallets exist and none of them pays the
model in front: a subscription that ended in the middle of a session, or a provider outside the four. The
popover then lists every wallet with its own line, and that is the only place the reason lives — before this,
the figure vanished and the reason with it (measured 2026-11-01, an expiring Go workspace with the credit
still at 30%: nothing in the header said a word).

The words a failed read shows are the reader's, not the body's: a Go workspace with no plan says `no Go plan
on this workspace`, because the console answers without meters exactly then, and `unexpected go status shape`
described a JSON object to someone looking at their credit.

**One decision, in `budget.ts`**: `connected(snapshot)` answers "does any wallet exist", and a wallet that
exists and whose read failed still counts — the fault is what must be seen, not an absence. Both halves
read it, so the state cannot be recognised on one surface and missed on the other. It is covered by
`budget.test.ts` (`npm run test`), which is the only part of this that needs no client, no credentials and
no switch: an account with nothing at all, a wallet in error, and one of each of the four.

The server half follows the same rule it already had, now without its one exception: **a wallet with no
connection is left out of the snapshot**, Zen included. Before, a machine with no Console account carried a
permanent `OC —` line explaining a connection that had never been made.

**The test switch** is `OC_BUDGET_DEV=empty`: `scripts/oc-dev-env.sh on OC_BUDGET_DEV=empty` fakes a
snapshot with nothing in it, and `off` returns to normal. It answers **before** the cache and is never
cached, so a real reading cannot be served while it is on and the fake cannot outlive the variable. It is
inert unless set — the convention every plugin follows (`docs/plugin-surfaces.md`, *One server, many
clients*), first paid for by `oc-plugin-updates`' switch.

What it still cannot prove is a real account that has never connected anything: that one exists only on a
machine that is not this one.


`budget.ts` holds what both halves must agree on — the four thresholds, `payingWallet`,
`bindingWindow` and `windowPercent` — and `peak.ts` the tariff; each half keeps its own formatting.

## The header popover

`header-menu.tsx`, and it is the plugin's only dependency.

The pattern is the app's own (`packages/gui-plugins/src/details/popover.tsx`): a **Kobalte** popover whose
open state is ours, so a second click on the trigger closes what the first opened. The platform's
`popover="auto"` cannot: it dismisses on any click outside the panel, the trigger is outside, so the click that
should close arrives at a button whose panel is already gone and reopens it — measured 2026-11-01, and the
reason the hand-written `anchor-name`/`anchor()` code went away with it.

`@kobalte/core` is pinned **exactly, `0.13.13`** — the version in the app's own catalog (`anomalyco/opencode`,
root `package.json`, `catalog`), the engine the app's `Tooltip` wraps and the library its details plugin uses.
It is bundled into our half, so it does not follow their upgrades: if the panel ever looks or behaves unlike the
app's own popovers after an update, the first suspect is that drift — check their catalog, bump ours, rebuild.
`scripts/check-sdk.sh` already fails when the installed SDK is not the running app's version, which is the
alarm that starts this check.

Two details the host does not give us: a `ctx.ui` has no popover, so this is where the rule from
`docs/gui-plugins.md` applies — the host's components where they exist, the app's own library where the kit has
a hole. And the hover hint is wider than the panel, so a stylesheet rule hides the host's tooltip while
`aria-expanded` is true: their own details panel needs no such rule because it is drawn over the hint.

Three consequences, measured on the review of that commit:

- **The tooltip rule is app-wide, not ours.** CSS cannot select the app's tooltip of one trigger, and the
  panel is not modal, so while a figure is open no tooltip draws anywhere in the window. A trade, not an
  accident: the alternative was leaving the hint visible beside a panel narrower than it.
- **The panel is portalled into the body.** The old inline popover hid with the timeline that owned it; this
  one does not, so whether it floats over another session when the app hides a cached timeline is the app's
  behaviour, unverified here.
- **Its props are actually checked, which is new.** The library's typings speak the real `solid-js`, so they
  only resolve if the program uses it: `types/shims.d.ts` does not declare the module, and the holes are
  filled as a global `JSX` whose `Element` is Solid's own (`docs/gui-plugins.md`, *Traps*). Measured on that
  commit: with the old ambient shim, a misspelt prop on `Popover.Trigger` compiled; with the real typings it
  does not.

## Publication

`@rizal72/oc-budget` on npm, and the workflow is what publishes it: a version bump and a push
(`.github/workflows/publish.yml`). The first publish was **by hand**, because the workflow reads its trusted
publisher from a page a package that does not exist yet does not have (`docs/publishing.md`, *A new
package*); from the version after, the push is the publication.

**`0.1.3`, 2026-11-09.** The three Go windows each carry a bar, and the alert follows the window that stops
the subscription first. Before it, no version was recorded here.

## Not ported from pi-budget

- **OpenRouter per-model posture shield**: ported from pi-budget, **removed 2026-10-29**. On pi it marked
  the routing of a pinned model; here the only datum is the account-level `allowed_data_regions` from
  `/key`, which is a policy this account has never set — so the glyph could never appear, in either half.
  The field, the helper and the glyph are gone. If it is ever wanted, it has to be built on how OpenCode
  exposes routing, not on this field.
- **The transient panel** (`setWidget`, self-clearing) has no equivalent worth having here: the sidebar
  is persistent and holds the same detail.
- **Session cost**: OpenCode already shows it in its own header.

## The blank night (2026-10-27)

Between 01:24 and 07:39 UTC the RPC answered **HTTP 500 on every call**, one per poll. The
widget was not empty during that time: the TUI keeps the last good snapshot when a read fails, so it
showed numbers from before the failure and said nothing. The blank appeared only when a client started
fresh and had no snapshot to fall back on — which is how the owner found it in the morning. A client
restart healed it.

**What the log can say.** The server writes the status and nothing else. Of the four conditions that
produce a 500 on an RPC method, only two leave that single line and no `ERROR`: `rpc.invalid_output` (the
returned value cannot be encoded against the output schema — the one class that logs nothing at all) and a
defect escaping the handler pipeline. A throwing handler logs `rpc handler failed`; an encoding failure
logs `failed to encode response`. Neither appeared.

**What was ruled out by experiment**, not by reasoning:

| hypothesis | result |
|---|---|
| reload storms (three files touched within a second) | 200 |
| reloading only `rpc.ts`, the shared contract | 200 |
| an extra field in the output against `additionalProperties: false` | **200 — the encoder drops undeclared properties before validating**, so this is not the class either |
| the console token expiring | its expiry is 25 Nov, not that night |
| a timeout | every call, failing or not, took ~1 s |
| the DeepSeek peak window | that logic never reaches the server — it lives in `peak.ts`, shared by the terminal and the panel — and the first failure is at 02:24 local, not 08:00 |

**What changed, without knowing the cause:**

- the handler cannot reject: `collect().catch(failedSnapshot)` answers a snapshot carrying the message in
  all four wallets, so a throw becomes readable instead of a 500;
- `zen.org` is omitted unless it is a string: a label of another type is exactly the kind of value the
  encoder refuses;
- the TUI states what happened — `stale 25m` when the last reading is older than two polls, the failure
  message when the last read failed, `budget —` when there has never been a snapshot.

**Open:** the class is still not identified. A client sees only `_tag`/`type`/`message` of the
`RpcInternalError`, and nothing publishes RPC failures as events, so the body of those 500s is gone. If it
recurs, the panel will name the failure instead of hiding it.

## Gotchas

- `Rpc.define` must carry `events`, even empty: the loader walks it and a missing map fails the whole
  plugin with `Object.entries requires that input parameter not be null or undefined`.
- A TUI plugin's edit is applied **live**, `setup` included: a change that never appears usually means
  the file stopped compiling, and the running instance keeps rendering the last good build. Editing
  `index.ts` reloads the server half, but its five-minute cache is what delays a new fetch.
- A Solid component body runs **once**. Every value that depends on the snapshot or the model is read
  inside `createMemo` or inside JSX; reading it in the body is how the first version froze on
  "reading…" for ever while still rendering its heading.
- Calling a registered RPC over HTTP needs the input wrapped: `POST /api/rpc/budget/snapshot` with
  `{"input":{"force":true}}`.
- **A read taken at a window's turn can arrive without `resetsAt`**, and that answer stays cached for five
  minutes. The surfaces then print `↻ now`, which is true where it appears: the window has just restarted,
  and the next read names the real reset. A computed estimate was rejected — the calendar makes the monthly
  one a special case, and forty lines of arithmetic to shorten a five-minute gap is more than the gap is
  worth (2026-11-10, the 5h turn).

## Measured 2026-10-16

- Go usage: account 1 (`sk-…`) 71%, reset 26 Oct; account 2 (`oc_sk_…`) 0%, reset 1 Nov.
- DeepSeek balance `$9.28`; OpenRouter `$3.22` of `$10.00` (used `$6.78`, month `$2.62`, regions
  `global`); Zen `$12.84` on workspace `go`.
