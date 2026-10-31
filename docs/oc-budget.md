# oc-budget — the record

One widget for the active provider's budget, ported from pi-budget but reading OpenCode's own
credentials instead of a file of ours. The operative summary is in the AGENTS index; this is the
record.

Config: none of its own. The only thing to configure is the plugin path in
`~/.config/opencode/opencode.jsonc`, and the credentials, which live in OpenCode's integration store
(`opencode auth login`).

Its sidebar block reaches the top with `prepend`, like the other two of ours; the mechanism and the
measurement are in `docs/sidebar.md`.

## Where it lives

| file | half |
|---|---|
| `plugins/oc-budget/index.ts` | **server**: resolves credentials, reads the four wallets, caches, registers the RPC |
| `plugins/oc-budget/tui.tsx` | **TUI**: two slots and `/budget`, nothing else |
| `plugins/oc-budget/gui.tsx` | **GUI**: the figure in the session header and its popover, over the same contract |
| `plugins/oc-budget/rpc.ts` | the one contract both halves import |
| `plugins/oc-budget/peak.ts` | DeepSeek's two tariffs, shared by both surfaces; `--self-check` |

The loader does **not** read `package.json` for a directory target: it looks for files named
`server`/`index`, `tui`, `rpc` at the package root (`PackageModule.resolve`). Entries therefore stay
at the root, and `exports` is kept only so the package would resolve by name if it were ever published.

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
| `openrouter` | env (`OPENROUTER_API_KEY`) | `OR $` |
| `opencode` (OpenCode Console) | oauth | `ZEN $` |

An integration can hold **several credentials with one active**, which is what makes account switching
free: `connection.active` follows the active one, so the widget never needs to know there is more than
one account.

## The four wallets

| state | what it shows | source | thresholds |
|---|---|---|---|
| `GO nn%` | the subscription pays | console `go/status` meters (fallback `zen/go/v1/usage`) | green < 90, yellow from 90, red at 100 (exhausted) |
| `ZEN $x.xx` | the pay-per-use credit pays | console `billing/status`, `availableMicroCents` | green > $5, yellow ≤ $5 (the console's auto-recharge), red at 0 |
| `DS $x.xx` | native DeepSeek wallet | `GET api.deepseek.com/user/balance` | green > $2, yellow ≤ $2, red at 0 |
| `OR $x.xx` | OpenRouter credits | `GET openrouter.ai/api/v1/credits` (+ `/key`) | green > $5, yellow ≤ $5, red at 0 |

**A wallet with no connection never reaches the window.** The server leaves it out of the snapshot
rather than filling it with an error, so the sidebar's block, the wallet sections of `/budget` and the
header figure draw only what the account has. Two lines still speak of a wallet the snapshot lacks,
because they talk about the *model* rather than the wallet: the footer, and `/budget`'s first line — a
Go model on an account with no Go connection still says so, and prints no figure. A connection that exists but whose read failed is a different thing and keeps its line with the
reason: an absence is silent, a fault is said. Two consequences worth knowing:

- **Zen is always reported.** It is OpenCode's own wallet, so a missing Console connection leaves
  `ZEN —` with the reason instead of removing the line.
- **Go is hidden when neither path can read it.** The Console session and a Go key are each enough on
  their own; when the Console is absent, or its read fails, and no Go key resolves, GO is left out — a
  workspace without the subscription answers a failed read exactly like a broken endpoint, and reporting
  that would put a permanent error under every free account. A Console connection that exists but cannot
  produce a token is a fault and is reported, and so is a failed read when a Go key is present.

Which wallet *pays* is decided by the TUI, the only half that knows the selected model:
`deepseek` → DS, `openrouter` → OR, `opencode`/`opencode-zen` → ZEN, `opencode-go` → GO unless the
monthly window is `rate-limited`, in which case the gateway falls back to ZEN.

The sidebar prints one line per Go window, its reset on the same line — `5h 4%   reset 2h 10m`,
`wk 31%  reset 3d 14h`, `mo 16%  reset 24d 3h`. The labels are muted, **each percent is coloured on its own
value** by the same rule as the bar above it, and the percent is padded to five characters so the countdowns
line up. Before 2026-10-29 the three figures shared one row and only the monthly reset was printed; three
counters side by side plus three countdowns need about 45 columns, and this panel does not know the width
of the sidebar, so the block grows down instead of across — one row more than the two lines it replaces.

One name, in the Go block: `workspace: go-2`, a line of its own after the windows — the label dim, the name
in the accent oc-git gives the branch, the only identity colour in a panel of state colours. A dim rule of
fixed length follows it and closes the Go block, so the wallets below read as a separate group — 20 columns,
fixed and not measured because the panel does not know how wide the sidebar is. It clears every line the
block prints short of exhaustion: the widest is `mo 100%  reset 24d 3h`, 21 columns, and a window row at
three digits with a day-scale reset is the only case that runs past it. The workspace is not a
property of the balancing wallet: it is the console session, which governs the Go windows *and* the `ZEN`
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
fail the error names both. The Zen balance has no such choice: only the console session opens billing, so
`ZEN` needs that connection and nothing else.

The Go percents come from `console/api/go/status`, whose `access.meters` gives the spend in micro-cents
against a known limit: the only form that can agree with the page the owner is looking at. Both sides of
that page were read, the endpoint and the bundle, because the first answer was wrong.

- the console's own rule, from its bundle: `(used*200 + limit) / (limit*2)`, i.e. **round** the percent,
  and cap it at 99 until `used >= limit` — that is the `>99% used` the page shows, and the cap keeps the
  paying wallet from falling back to ZEN before the limit is actually reached;
- the public `zen/go/v1/usage` rounds **down**, so it answered `0 0 0` while the page read `1% 0% 1%`
  (measured 2026-10-26, same workspace, same minute: 1.04% / 0.42% / 0.99% of the three limits). It stays
  only as the fallback for a machine with no console session, where its integer is all there is.

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
opencode auth switch opencode            "<label>"   # ZEN
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

- **terminal**: a red mdi trending-up glyph next to the amount and next to the Go bar. Since 2026-10-29 the
  block marks from `isPeak`, not from `doubles`: it appears on GO and DS whoever is paying, because the
  reminder not to switch *to* them is worth more than a report on the one in use. The footer keeps
  `doubles` — it shows one wallet, the one paying;
- **desktop**: `↗` at the end of the figure's label when what you are paying doubles — the footer's rule.
  In the popover, `↗` sits on the Go bar and on the `DS` line whenever the hour is peak, whether or not
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
colour, as pi does: a coloured mark beside a coloured word would be two signals for one fact.

## Desktop half

The desktop has a figure where the TUI has the footer and a popover where it has the sidebar block, and
the two now say the same thing: the **figure carries the paying wallet** (`GO · 7%`, with a ring filled to
the month), and the **popover is the block** — the Go bar, one row per window with its reset, the workspace, a rule, then DS,
OR and ZEN.

The block is the plugin's own popover, in the top layer and anchored to the figure: no host menu wraps it,
so the width, the rows and the per-row ceiling that a `ComposerPill` `menu` imposed no longer apply
(`docs/gui-plugins.md`, *Where a contribution lands, by layout*).

- the **bar** is proportional to the monthly percent, clamped to its track, coloured by the terminal's own
  rule — green, yellow from 90, red at 100 — and the figure beside it takes the same colour;
- every figure is coloured **on its own value**: the three windows, each wallet's balance, the workspace in
  the accent. The colours are the app's CSS variables (`--v2-state-fg-*`, `--v2-text-text-muted`), never
  hex: a GUI plugin has no theme API, and those tokens are the theme's own three alert levels;
- the **three windows are three rows**, each with its own countdown right-aligned, exactly as the block
  prints them: the snapshot already carried a `resetsAt` per window, and the popover shows all three
  instead of naming the monthly one alone;
- **the peak `↗` marks GO and DS whoever is paying** (`isPeak`): its job is the reminder not to switch to
  them. The figure's `↗` marks only the paying model (`doubles`). Two questions, two functions — the rule
  `peak.ts` documents;
- the popover **forces a read on open** (`{ force: true }`, past the server's cache), because the tick is
  five minutes: a wallet connected or removed a minute ago would otherwise stay invisible for the rest of
  the TTL;
- the workspace is named only when the console account has peers, as the block does;
- `order` is 15, after coffee's 5 and git's 10, which is the order `opencode.jsonc` gives them in the
  TUI: the desktop sorts pills by that number, not by load order;
- the read goes through the **session's own server** client, like git's, and refreshes every 5 minutes;
- **three states, never two** (`docs/gui-plugins.md`, *a pill never shows a stale value as fresh*): fresh
  as above; **stale** when the last good reading is older than two polls (10 min) — the label takes a `~`,
  the tone `warning`, the title `Budget · last read 12m ago`, and the popover opens with the same line; and
  **nothing read yet with a failure** — the label `budget`, icon `circle-exclamation`, tone `danger`, the
  error in the title and as the popover's only text. A failed poll keeps the last good reading and asks
  again in 30 s; it does not blank the pill. Before the first answer it stays hidden: a fresh window is not
  a fault.

`budget.ts` holds what both halves must agree on — the four thresholds, `payingWallet` and
`windowPercent` — and `peak.ts` the tariff; each half keeps its own formatting.

## Open items

- `/budget`: the report is plain text and its numbers carry no colour — the dialog takes a
  string, so colouring them would mean drawing the report as a custom JSX dialog. The sidebar's
  window line is coloured; the report is not.

## Not ported from pi-budget

- **OpenRouter per-model posture shield**: ported from pi-budget, **removed 2026-10-29**. On pi it marked
  the routing of a pinned model; here the only datum is the account-level `allowed_data_regions` from
  `/key`, which is a policy this account has never set — so the glyph could never appear, in either half.
  The field, the helper and the glyph are gone. If it is ever wanted, it has to be built on how OpenCode
  exposes routing, not on this field.
- **The transient panel** (`setWidget`, self-clearing) has no equivalent worth having here: the sidebar
  is persistent and holds the same detail.
- **Session cost**: OpenCode already shows it in its own header.

## The eleven-hour blank (2026-10-27)

Between 01:24 and 07:39 UTC the RPC answered **HTTP 500 on 110 consecutive calls**, one per poll. The
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

## Measured 2026-10-16

- Go usage: account 1 (`sk-…`) 71%, reset 26 Oct; account 2 (`oc_sk_…`) 0%, reset 1 Nov.
- DeepSeek balance `$9.28`; OpenRouter `$3.22` of `$10.00` (used `$6.78`, month `$2.62`, regions
  `global`); Zen `$12.84` on workspace `go`.
