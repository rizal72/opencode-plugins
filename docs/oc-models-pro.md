# oc-models-pro

**Status: working.** `/models-pro` renders the model list in a session panel — prices, context,
intelligence and the Go credit in columns — and switches the model in the session. Open items, all
decided against for now, are at the foot of this file.

The same table is a side panel in the desktop app, opened with `⌘⇧M` (see *Desktop half* below).

Port of Pi's `pi-model-pro`. Command `/models-pro` (plugin `plugins/oc-models-pro/`), beside the native
`/models`: the native picker is untouched — there is no `remove` in either registry, and shadowing
`model.list` was never tried.

## Why a panel and not a dialog

The picker first shipped as `ui.dialog.select` with one padded row per model. It worked, and died on a
measurement: a 70-character ruler row in the dialog stopped at **position 60**. The cap belongs to the
*option text*, not to the dialog, which is about twice as wide — but it meant prices, context,
intelligence and the credit could never sit side by side.

That route was then deleted rather than kept as a fallback: the native `/models` already *is* that
dialog, so a copy of it is a worse duplicate. The fallback for a panel that disappoints is the native
picker itself.

## The two letters in the first column

Every row carries its provider, because the flat view has no headers to say it.

`tags.ts` gives every provider two letters, unique in the catalogue:

- **`opencode` → OC, `opencode-go` → GO** — the host's own providers, present in every installation, so
  those two tags are reserved: no derived one may take them, even when the provider is absent.
- everything else comes from the **display name**, which is the only place a merged name still shows its
  seams: `OpenRouter` → OR, `DeepSeek` → DS, `GitHub Copilot` → GC. A camelCase split only happens when
  the name has no separator, so a brand like `GitHub` stays one word.
- **collisions** are resolved by walking the name for a free pair, skipping doubled letters: `Google`
  would ask for GO, finds it reserved, and becomes **GL**. The walk runs in alphabetical order of id, so
  the same catalogue yields the same tags in every session and whatever order the providers arrive in.

`node plugins/oc-models-pro/tags.ts --self-check` covers the reserved pair, the three names above, the
`Google` case, two providers with the same name, and the order independence.

## How it behaves

`ui.slot({ append: "session.panel", render: (panel) => <Show when={panel.name === "oc-models-pro"}>… })`
carries the list, and `ui.panel.open("oc-models-pro")` opens it — false outside a session. On a wide
terminal it takes the right half and the sidebar gives way; on a narrow one the host makes it full
screen.

| key | does |
|---|---|
| `↑` `↓`, pointer | move the selection — hover *is* the selection, as in the native lists |
| click | select and switch |
| `Invio` | switch the model and close |
| `ctrl+o` | sort cycle: effective↑, in↑, out↑, in+out↑, ctx↓, int↓, speed↓, recently used, provider, name |
| `ctrl+s` | scope cycle: `all → favorites → paying` |
| `ctrl+g` | provider groups on/off |
| `ctrl+r` | order by recently used |
| `ctrl+u` | clear the search |
| `ctrl+f` | add or remove the selected model from favourites |
| `ctrl+y` | full screen |
| `esc` | clear the search, else close |

A line of its own under the title carries the legend, in parentheses — `×N = Go credit`, `peak*2 = the tariff doubles at peak`,
`+Nx = promotion` — because a column of `×8` and `peak*2` means nothing on its own.
| `<leader>p` (`Ctrl+X` then `p`) | open the panel from anywhere |

The keys live in a layer registered inside the panel component (`enabled: () => panel.focused`), so
they are active only while the panel owns input and cannot take `esc` from the prompt.

`Invio` switches and closes, then — **only if `model.json` has no `variant` entry for that model** —
opens the host's own variant picker (`Default` plus `ui.model.variant.list()`). The answer is applied
with `ui.model.variant.set`, which is what writes the file: the panel keeps no variant state of its
own. A saved `default` counts as an answer, so the question does not return; cancelling leaves the model
without one, and then it does — the same behaviour as the native picker. The answer is only asked for
when the host reports the new model as current: a switch that never lands shows no dialog, rather than
writing a variant to whatever model happens to be selected.

**Nothing is announced on success.** The composer shows the new model and the transcript carries the
note, as with the native picker; only a switch that does not land is announced, naming the model still
running (see *How the switch reaches the client*).

Columns are 85 characters in all at the panel's widest: `NAME = 32` plus 53 of
fixed cells — in 6, out 6, ctx 5, int 5, `tok/s` 6, cred 4, note 6, the marker and the tag, and the nine
separators. The note cell holds a peak (`peak*2`) or a promotion note (`+4x`), and the marker cell holds
`●` for the model in use and `*` for a favourite (a row can carry both). The star is not drawn inside
the `favorites` scope, where nearly every row is one — the exception is the model in use, which the
scope keeps even when it is not a favourite, and that row stays unstarred. Every cell is cut to its
width, so nothing can shift a row's columns to the right. The sort and the scope are signals: as plain
variables they left the title saying "effective price" whatever the list was sorted by.

## How the switch reaches the client

The host owns the model: it keeps a **selection per (session, agent)** in its own memory, the composer
shows it at once, and the prompt sends it to the server. The native picker writes it with the host's
`model.set`; the request to the server follows with the next prompt, model *and* variant
(`{providerID, id, variant}`), and the note in the transcript is the server's answer to that request.

The plugin API has no `model.set` — `ui.model` reads the selection and changes its variant, nothing
more — so a plugin **cannot write it directly**. Asking the server instead (`session.switchModel`)
changes the session on the server and nothing on screen: the client's selection wins, and at the next
prompt the client sends its own back, undoing the change. That was the panel's path from its first
commit, and it looked like it worked only because the early version reported "selected" without
checking. The mechanism is confirmed upstream: the TUI takes a model change only to confirm a switch it
started itself.

What a plugin **can** reach is the host's own command for it: `model.cycle_favorite` ends on the first
favourite — the same internal call the native picker makes — so the panel prepares the list for that
call and puts it back right after. One entry is what makes the call safe to repeat: whatever is
selected, it lands on that entry, so a second dispatch covers the moment the host had not read the file
yet. The favourite list is a transport, not a choice: the model you pick from the panel need not be a
favourite, and the list is restored as it was — also when the switch does not land.

Two things follow. The variant is resolved by the host, as the native picker resolves it (the entry
saved for that model in `model.json`), so nothing has to travel in a request. And the success toast is
gone: the composer is the notice, the transcript note is the server's; only a switch that does not land
is announced.

**When upstream exposes `ui.model.set`**, the panel takes it on its own: `selectModel` checks for it at
runtime and uses it when present. Nothing else to remove — the list never leaves the file in that case.
Asked upstream as [anomalyco/opencode#57771](https://github.com/anomalyco/opencode/issues/57771).

## Desktop half

The window has no Node and no environment, so the data is assembled on the other side of the split:
`index.ts` runs in the server half, reads the four sources and answers one `models.snapshot` with every
row, the credit table and the favourites (`rpc.ts`). The key and the caches are therefore the terminal's
own — the sidecar carries `ARTIFICIAL_ANALYSIS_API_KEY` and no `XDG_CACHE_HOME`, so `~/.cache` as
before (measured 2026-10-27). The window draws rows and nothing else.

The switch is the app's own: `ctx.screen.current()?.composer.setModel({ providerID, modelID })` writes
the host's selection, records the model as recent and lets the host resolve the variant; it returns
`false` when the model cannot be used, and only that is announced. **None of the transport above is
here** — no `cycle_favorite`, no rewrite of the favourites, no variant dialog. Issue #57771 and the
trick it describes are debt of the terminal alone: a desktop switch needs neither.

Two lists stop at the server's answer. The snapshot carries `enabled` and the panel keeps only those
rows, so a model switched off under *Manage models* is filtered here rather than trusted to the host's
promise. The app's own favourites are unreachable (their store belongs to the window), so the stars here
are `model.json`, the file the terminal writes — one list, two surfaces.

`fit.ts` does not apply: it counts columns of a terminal. Each track is sized to its own header instead
— the label sets the width, the figure fits inside it — and columns go in `fit.ts`'s order: tok/s and
the note, then context, then intelligence; the price figures never go, they are why the list exists. The
tracks live in `gui.tsx`; the header is padded by the scrollbar's measured width, because it sits outside
the scrolling list and would otherwise be wider than its rows.

## When the panel is narrow

The host hands the panel a `width` in columns, and it is the only lever: `presentation` tells the same
story one step late and is not read. The thresholds live in `fit.ts`, with a self-check —
`node plugins/oc-models-pro/fit.ts --self-check` — because a layout bug here is invisible in a wide
terminal.

The name column gives way first, then whole columns, and the footer never truncates. The table is fitted
to **one column less than the panel** — the scrollbox draws its scrollbar in the last column, so a row
that filled the panel lost its last character behind it — while the footer uses the whole panel width.
Widths below are **panel** columns; the name runs down through the range shown, then the next column
falls.

| panel | name | dropped | footer |
|---|---|---|---|
| ≥ 103 | 32 | — | one line |
| 86–102 | 32 | — | two lines |
| 78–85 | 24 → 31 | — | two lines |
| 71–77 | 24 → 30 | `tok/s` | two lines |
| 64–70 | 24 → 30 | + `note` | two lines |
| 58–63 | 24 → 29 | + `ctx` | two lines |
| 52–57 | 24 → 29 | + `int` | two lines from 54, three below |
| ≤ 51 | 24, clipped | all four | three or more |

`tok/s` goes first because a speed reading is the least decisive of the four; `int` goes last because it
is what the choice actually turns on. The name stops at 24 characters — below that a model name is unreadable and a column
is worth more. The table fills the panel again after each drop, so a column leaving returns its space to
the name; the trade is a step up in name width at each threshold. The legend shortens to
`×N credit · peak*2 · +4x promo` under 72 columns rather than being cut mid-sentence.

## Scopes, and where the free models go

`ctrl+s` cycles `all → favorites → paying`; **`all` is the default**, because the free models are worth
seeing without a detour. `paying` hides every model whose input and output price are both zero — the
model in use excepted, so the panel never loses it. A missing price is not a free one: the figure stays
blank and the row stays with the paying models.

The first line carries the scope in **bold**, alone: the sort and the grouping are information, the scope
is the lens that changes the list.

Free models never enter the price order: zero is not the cheapest price, it is no price, and at the top
they would hide everything that costs something. With the provider groups on they keep their provider's
header and sit after its paying rows, in the active order — so a provider that only serves free models
still gets a group of its own, instead of vanishing into a bucket elsewhere. Flat, they all go under one
`Free` header at the end. Nothing marks them beyond the word `free` in the price column.

That whole paragraph is one function, `arrange` in `rows.ts`, called by both surfaces: it was written
twice, and the two copies drifted the first time a filter was added. Groups are keyed by `providerID` and
labelled with the display name, so two providers that share a name stay two groups.

A group header shows the provider first, the account in brackets: the host names an account-bound
provider `<account> / <Provider>` (`go-1 / OpenCode`), and that order reads as if the account were the
name. The swap happens only when both sides have text, so a provider with no account — or an odd name —
is printed as it arrives, and an account switch (`go-2`) needs no code.

**The model in use is the exception: it is the first row, free or not.** The split is about prices, and
the model in use is the state of the session, not a price to compare — so it is never buried in the
bucket. Flat it stays above the paying rows, grouped it leads its own group. The other free models are
untouched by the rule.

## Measurements that shaped the code

- **Theme colours arrive as RGBA objects** (`{buffer:[r,g,b,a]}`). `fg` takes them, a box background
  wants a string, so backgrounds go through a hex conversion. `background.action` is a *button
  structure*, not a colour: the cyan of an active control is `background.action.primary.focused`, and
  the usable greys are `surface.base` / `surface.high`.
- **`panel.width` reads as pixels on the first render** and settles in columns later — the header
  shifted while the list stayed aligned. Columns are therefore fixed, not derived from it.
- **An `input` needs the native dialog's own recipe**: `traits = { status: "FILTER" }` on the ref, then
  `element.focus()` a tick later, plus `flexGrow`, a placeholder and the field colours. Without them it
  draws nothing and receives nothing.
- **Hover**: over/out fire in pairs a few milliseconds apart, so an `out` handler flickers the row off.
  The selection moves on `over`, and a wheel scroll suppresses it for 150 ms — the native list behaves
  the same way.
- **The host already owns panel focus**: `pane.focus.right` / `pane.focus.left`, default `<leader>right`
  and `<leader>left`. Nothing to build.
- **`ctrl+f` toggles a favourite** exactly where the native dialog does it, by editing the app's own
  `~/.local/state/opencode/model.json`: the entry goes into or out of `favorite[]` (all copies, if the
  file somehow holds duplicates), `recent[]` and `variant{}` are carried over, and the write is
  `.model.json.tmp` + rename — the leading dot keeps the temp name outside the `model.json.*` glob the
  host watches, so it never sees half a file. A missing file is created; only a real write error is
  reported. The host watches that path, and so does the panel while it is open (the directory, which
  survives the rename), so a favourite changed from the native picker lights the star here too.
- **The list follows the selection**: every row carries an id and the `scrollbox` is asked for
  `scrollChildIntoView`, so the arrows walk the whole list, not just the visible page.

## Data

- **Prices** are the catalogue's own, never adjusted. The order uses the **effective price** =
  `input ÷ credit`; `in+out` divides by credit too, while `in↑` and `out↑` stay list price — otherwise
  `in↑` would be the same sort as effective. **Peak is not in the ordering**: the catalogue price is the
  off-peak one and the order stays on it whatever the hour, with `peak*2` in the note saying the tariff
  doubles. Peak hours themselves live in `oc-budget`.
- **Peak is one fact per plugin, deliberately duplicated.** `peak*N` is the Go plan's **measured** ratio
  (`peak.input ÷ off.input`) and it reaches only `opencode-go` rows, because it comes from the Go credit
  table. The catalogue lists a single price per model, so nothing there can report a second tariff; the
  rows whose *list* price doubles get the ratio from `nativePeak()` in `multipliers.ts` instead. Two copies
  of one fact, one per package, because they are published apart and neither may import the other: each
  has to work alone. `oc-budget/peak.ts` owns the hour and the wallet; this plugin owns only which list
  price doubles, which is why the note is static and the ordering never looks at the clock.
  Verified 2026-10-28 against DeepSeek's own pricing page — `deepseek-flash` $0.15 off-peak / $0.30 peak,
  `deepseek-v4-pro` $0.66 / $1.32 — and the catalogue carries the **off-peak** figures, so `*2` is the
  truth and not a guess. Zen is excluded by the rule itself (its DeepSeek price is flat), and so is
  OpenRouter (its prices are its own).
- **The Go plan** — `plugins/oc-models-pro/multipliers.ts`, from
  `https://opencode.ai/v2/docs/console/go/` (server-rendered, no auth), cached one day at
  `$XDG_CACHE_HOME/oc-models-pro/go-limits.json`, else `~/.cache/oc-models-pro/go-limits.json`.
  The credit is the monthly limit ÷ the $10 plan, matched **by model id and only on
  `opencode-go`** — the ids there are bare (`opencode-go/deepseek-v4.1-flash`), so
  the page's display name and the id meet after `key()` normalisation; by name alone, OpenRouter's
  "DeepSeek V4.1 Flash" inherited the Go credit. The `.mdx` on GitHub is stale by design — never cache from it. Self-check:
  `node plugins/oc-models-pro/multipliers.ts --self-check`.
- **Intelligence** — `plugins/oc-models-pro/bench.ts`, from `https://catalog.stencil.so/models.json`,
  cached 6 h at `$XDG_CACHE_HOME/oc-models-pro/bench.json` (else `~/.cache`). 4612 of 9050 entries
  carry `int`; **`tps` is on none of them** today (measured 2026-10-19; the same URL served it for 1004 of 1191 models on 2026-10-14 —
  stencil regenerates its payload from models.dev and the speed field went with the old generation).
  Stencil's ids are qualified (`alibaba/deepseek-v4.1-flash`), so the key is built from **our model's
  display name** with labels (`latest`, `contributor`, `free`, `preview`, `exp`, `thinking`) and snapshot
  stamps (`1017`) stripped, falling back to the id: that is what makes "DeepSeek V4.1 Flash 1017" meet
  `deepseek-v4.1-flash`. Coverage over the 469 models of this install: **248 matched**, seven misses on
  `opencode-go`, all genuinely absent upstream. Self-check:
  `node plugins/oc-models-pro/bench.ts --self-check`.
- **Speed, measured** — `plugins/oc-models-pro/tps.ts`, from this machine's own sessions. Per assistant
  turn: `(tokens.output + tokens.reasoning) ÷ (last token − first content token)`, i.e. the number
  the industry publishes — Artificial Analysis' "output speed", and `completion_tokens` as OpenAI,
  Anthropic and OpenRouter bill it, where reasoning is part of the output. Turns under 200 ms or under 20
  tokens are dropped; the figure is the **median** per `providerID/modelID`, over the **last 7 days** when
  that window holds at least three turns, over all of history when it does not. Cheap enough to recompute at every panel
  open: measured 2026-10-27, a few thousand turns cost about a tenth of a second in the host and about a
  third under node, where `bun:sqlite` is missing and the `sqlite3` CLI carries the read. Why it is not a
  catalogue number: the **same model differs by route**, and the two routes for one model are rows in the
  same list — a figure measured elsewhere is not your figure.
  **The trap this rests on**: `@opencode/ai` documents `output_tokens` as *inclusive* of reasoning, with
  `reasoning_tokens` a subset; the session store keeps them as **separate buckets** (measured 2026-10-27: one
  turn carried more reasoning tokens than output, impossible for a subset), and the contract's `total()` adds
  them. If the host ever switches to inclusive, the sum inflates the number — detectable by that same
  invariant, because a subset can never exceed its superset. Gemini is the known exception: its
  `candidatesTokenCount` excludes thoughts, which are counted separately.
- **Speed, borrowed** — `plugins/oc-models-pro/aa.ts`, from `https://artificialanalysis.ai/api/v2/data/llms/models`,
  free with an account (1,000 requests a day), key in `ARTIFICIAL_ANALYSIS_API_KEY`, cached 6 h at
  `$XDG_CACHE_HOME/oc-models-pro/aa.json`. Field `median_output_tokens_per_second`, mapped with the same
  name/slug normalisation `bench.ts` uses. **Without the key nothing happens**: no request, no cache, no
  error, and the column shows only what was measured. Values from here carry a leading `~` in the panel.
  How many of the models on offer actually get a figure is not written here: it moves with their
  catalogue and with ours. The panel's trace line prints it, in `<TMPDIR>/oc-models-pro.log`, as
  `N/M with a speed` — which is also how a thin column is told apart from a broken key.
  Their terms ask for **attribution** and for caching. The credit sits in `public/README.md`, the file the
  mirror publishes as the repository's README; the plugin README carries the link only to get a key.
  The key is read from the environment of the **TUI process**, which is the one that draws the panel and
  runs this module — not the server's. A TUI started before the variable was exported never sees it: a
  process reads its environment at birth. The desktop app re-reads the login shell before starting
  (`zsh -il -c "env -0"`, packages/desktop/src/main/lifecycle/environment.ts:31) with a 5 s timeout, and
  reads nothing on nushell or Windows.
- **No row is hidden** for being a duplicate: the same model on `deepseek` and on `opencode-go` is two
  offers. (An earlier rule kept only the cheapest and it hid `deepseek-v4-pro` from the provider hosting
  it.) Nor is a row dropped for missing data: a model with no price entry or no `limit` keeps its line
  with a **blank** cell instead of a claimed `0`, and blanks sort last in every order.
- **A credit other than 1 is always shown**, including below 1: the effective order divides by it, so a
  hidden `×0.5` would be a number the row moves by and never prints.
- **Failures are visible, not silent**: each fetch carries its own timeout (catalogue 20 s, plan page
  20 s, Artificial Analysis 5 s), a plan that could not be read (and no cache to fall back on) puts
  `credits n/a` in the title rather than passing every credit off as 1, an unreadable `model.json` leaves
  a line in the trace, and the three caches are written to a `.tmp` file and renamed, so a torn write
  cannot destroy the stale copy the failure path returns.
- **The keyboard layer is disposed by the host, measured**: each mount logs how many `models-pro.*`
  commands the keymap exposes — three openings in a row read 10 each time, never 20, so no layer
  survives its panel. The same line is the alarm if that ever changes.

## Not built, and why

- **A centred mode** — `mode: "panel" | "dialog"` in the plugin's own options, read when the command
  runs: `"plugins": [{ "package": "…/plugins/oc-models-pro", "options": { "mode": "dialog" } }]`. A plugin
  entry accepts `{ package, options }` and the plugin reads them from `context.options`, so it is one line
  at open and no runtime state. `dialog` is the same component inside `ui.dialog.show` with
  `ui.dialog.set({ size: "xlarge", centered: true })`, plus an adapter for what a dialog has no
  equivalent of (`sessionID` from the router, `close` → `dialog.clear()`, `width` fixed, `focused`
  assumed) — some 40 lines. Three measurements decide it, and a throwaway probe answers all three before
  this plugin is touched: how many columns `xlarge` really offers (the table needs 85), whether a keymap
  layer mounted inside the dialog receives keys, and whether that layer dies on close (one that survives
  would take the prompt's keys).
- **A speed column source — closed 2026-10-27.** The column is filled by our own measurement (`tps.ts`)
  and, for unused models, by Artificial Analysis under a key (`aa.ts`). What oh-my-pi does was checked and
  is not the model to copy: its live number is its own per-turn measurement, and its catalog fallback
  reads `catalog.stencil.so/models.json.zstd` — a `tps` field that served 0 of 8947 models on 2026-10-27,
  kept alive by a bundled snapshot (`packages/catalog/src/models.json`) whose upstream date is not
  recorded. Their picker therefore shows stale `~` values on a fresh install.
  Taking `int` from Artificial Analysis too remains a separate decision, not taken: it would move every
  number already read here (of 142 keys shared with stencil, only 78 agree).
- **Retiring the native `/models`** — there is no documented way to disable a built-in command: `cli.json`
  can unbind a key (`"model.list": "none"`), and the `commands` config only defines new ones. Shadowing
  it by registering a command with the same id on a higher-priority layer is untested. Even if it worked
  it would cost more than it gains: the native dialog is a client widget that also works on the **home**
  screen, while this panel needs a session (`ui.panel.open` returns false there), and no API sets the
  **default** model — `ui.model` has no setter at all (see *How the switch reaches the client*). A picker
  that opens on the home and cannot apply anything would be worse than the fallback it replaces.

## Accepted, not fixed

- **Gateway collisions in the benchmark index** (`benchKey`): two gateways publish different `int` for
  the same normalised name (`hy3` 25.3 on 23 of them, 22.7 on 5), and the index keeps the first row it
  meets. Pi prefers the `opencode-go` / `opencode` row. Measured on this install: of 271 keys, 262 agree
  everywhere, and the divergent ones are models not used here — so the preference would change nothing
  today and is not added.
- **`console.error` is the only channel outside the TUI** when a fetch fails: what a user can act on is
  already in the panel — `credits n/a` for the plan, a blank column for the score.
- **`Invio` while the search field holds text** switches the model, as in the native picker: the filter
  narrows the list, and Enter takes what is selected.
- **A concurrent write to `model.json` can lose a toggle**: `toggleFavorite` reads, edits and renames
  with no lock, while the host writes the same file on a model switch. The window is one read and one
  write, and the cost is one keypress; a lock of our own would be a second protocol to keep in step
  with the host's.
- **A switch that dies mid-flight leaves the favourites as one entry.** The list is the transport for
  the host's command, and it is restored a second later — a crash or a Ctrl+C inside that second keeps
  the prepared entry and drops the rest. The window is about a second and the cost is the favourite
  marks, not a session; a journal to survive it would be more machinery than the marks are worth.

## Files

- `plugins/oc-models-pro/tui.tsx` — the terminal panel, its keys and its rows.
- `plugins/oc-models-pro/gui.tsx` — the desktop panel, in the app's own components.
- `plugins/oc-models-pro/index.ts` — the server half: the four sources, the snapshot, the 60 s cache.
- `plugins/oc-models-pro/rpc.ts` — the two calls across the split: `models.snapshot` and `models.setFavorite`.
- `plugins/oc-models-pro/rows.ts` — what a row means to both surfaces, and what a list of them becomes: effective price, free, the orders, and `arrange`; `--self-check`.
- `plugins/oc-models-pro/prefs.ts` — `model.json`: read, write, toggle.
- `plugins/oc-models-pro/multipliers.ts` — the Go plan and the credits.
- `plugins/oc-models-pro/bench.ts` — the intelligence index.
- `plugins/oc-models-pro/tps.ts` — this machine's measured speed.
- `plugins/oc-models-pro/aa.ts` — the borrowed speed, under a key.
- `plugins/oc-models-pro/fit.ts` — the column widths at each terminal size. TUI-only: the panel measures itself.
- `plugins/oc-models-pro/tags.ts` — the two letters per provider.
- The closed work order, with every measurement taken on the way: `docs/archive/models-pro.md`.

## Publishing

Publishable as it stands: it reads the app's own `model.json` and public catalogues, and its only constant
is the Go plan in `multipliers.ts` — a fact about Go, not about this machine. Published as
`@rizal72/oc-models-pro@0.1.0` on 2026-10-22, `0.1.1` on 2026-10-23, `0.1.4` on 2026-10-25 with the compiled TUI
half; procedure in `docs/publishing.md`.
