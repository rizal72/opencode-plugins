# Desktop GUI plugins — the record

A GUI plugin draws inside OpenCode Desktop: panels, commands, settings pages, slots, composer pills,
titlebar items, native menus. It is the third part of a plugin package, shipped as
**`./gui-experimental`** beside the server part and the TUI part.

What a window shares with the terminal — one server and many clients, the dev switch, and which slot exists
on which screen — is in `docs/plugin-surfaces.md`.

## Provisional by design, and re-read on every release

The `-experimental` is not decoration: a shape here can change between app releases, and we accepted that
to have the surfaces at all. So our GUI halves are **provisional on purpose** — they work and they ship,
but the day one breaks it is a shim to rewrite, not a regression we owe anyone. The terminal halves are
the stable product; the GUI halves ride on the experimental API.

Every app release, two questions — the first is a gate, the second a reading:

1. **Does anything break?** `npm run check` fails when the SDK's version differs from the running app's, so
   a renamed export or a moved shape surfaces before a plugin does. **The app is the service, not the
   `opencode` binary on PATH**: the desktop updates itself and leaves the CLI alone, and a gate reading the
   CLI passed green against a 2.2.2 binary while 2.2.3 was loading the halves (measured 2026-10-30).
   `scripts/check-sdk.sh` asks `/api/info` and falls back to the CLI only when nothing runs. A CLI that
   lags the app is **upgraded on the spot**, to the app's version and never downwards: the second server
   a terminal would start is what has to be current, and asking each time is the one thing that does not
   happen. An upgrade replaces the binary by rename, so a TUI already open in a terminal keeps running the
   version it started with and the next one runs the new.
2. **What can we delete now?** A workaround written against a missing feature is dead weight the day the
   feature lands. The ones we carry today, and what retires each:

| workaround | gone when |
|---|---|
| one `icon` and one `label` per pill or row, `tone` on the icon only | the surface takes more than one icon — likelier than it sounds: icons are the first thing to grow |
| the prebuilt CommonJS bundle, dynamic imports inlined | the app can load a second chunk |
| the compiled `tui.js` in the published package (`docs/publishing.md`) | the packaged loader runs our TSX reactively — issue #39986 |
| a 2 s clock, and a 15 s guard on every call to the server | the host pushes a change event for what we watch |
| the header's scrollbar offset measured, never written | the header and the rows share one grid |
| `IconName` checked by eye, because the union is wider than the app draws | the union and the drawn set are the same thing |

Nothing here is a measurement: it is the price of the surface. Re-checking costs one pass over this page
and the traps below, at the one moment they can have moved.

## One package, three exports

```json
"exports": {
  ".": "./src/index.ts",           // server part
  "./tui": "./src/tui.tsx",        // terminal UI
  "./gui-experimental": "./dist/gui-experimental.cjs"
}
```

Users install the package once; there is no separate GUI install step. The GUI declares no id of its
own: it takes the server part's `id`, or the package name when there is no server part (a local
directory without a `name` uses the directory name).

## The bundle is prebuilt

Unlike the other two parts, `./gui-experimental` is **one CommonJS file compiled ahead of time**, with
the Vite preset from `@opencode/plugin/gui/vite` (defaults: `src/gui.tsx` -> `dist/gui-experimental.cjs`,
option overrides `entry` and `outFile`). The app cannot load a second chunk, so dynamic imports are
inlined.

- In development: `vite build --watch`. Each rebuild reloads the plugin's GUI in every window and in
  the main process; the server part does not restart.
- An installed package's GUI changes only with its version.
- A local directory resolves the entry through its `name` and `exports`, or falls back to
  `gui-experimental.cjs`/`.js` at the root. The entry must be `.cjs` or `.js`; anything else is ignored.

Only these modules may be imported: `effect`, `@opencode/plugin/gui`, `@opencode/plugin/gui/main`, and
the shapes the app provides (`@opencode/plugin/rpc`, `@opencode/client`, `@opencode/schema/rpc`) in both
processes; `solid-js/*` in windows; `electron` and Node built-ins in the main process. Any other
`effect/*`, `solid-js/*` or `@opencode/*` import **fails the build**, because a bundled copy would not
share the app's instance.

## Two processes, one file

- **`setup`** runs in every window: it contributes panels, commands, settings pages, slots, servers,
  link handlers and styles.
- **`main`** runs once, in Electron's main process: typed `Ipc` contracts, native menu items,
  `WebContentsView` embeds, Node and Electron.

Each process evaluates the whole file and reads its default export, so the other process's modules are
**inert placeholders** there: `electron` in a window, Solid in main. Keep each process's code inside its
own setup — module scope that touches the wrong side gets placeholders instead of values.

## Two traps in config

- **The desktop reads plugins from `opencode.json(c)` only**; the TUI reads `cli.json`. A package listed
  only in `cli.json` shows no GUI until it is also listed in `opencode.jsonc`.
- **A plugin whose server part fails to load has no GUI at all**, so a broken server half is not a
  missing feature, it is an invisible plugin.

Ids are prefixed per plugin (`<id>.<command>`, `<id>:<tab>`, `plugin.<id>.<key>`). The app's own ids are
reserved: a plugin whose id is one of them, nests under one with a `.`, or sits in the `opencode`
namespace does not load, and Settings > Extensions > Plugins lists it as not loaded.

## What the app already draws

The session header shows the context tokens and the session's cost on its own, and the side panel's
**Review** lists the files the session changed with their diffs. Those are the app's own figures for
one session, and nothing of ours redraws them — but the two that look redundant are not: the context
block carries the window the percent is a percent of, and the budget carries the provider's four
wallets, not the session's spend.

## Where our plugins land

| plugin | surface | why |
|---|---|---|
| `oc-git` | `ComposerPill` | branch and counts always visible; the details open on a click |
| `oc-budget` | `ComposerPill` with a popover (`menu`) | the paying wallet in the face, the other three and the Go bar one click away |
| `oc-context` | none: no GUI half | the block is the terminal's; the desktop draws the session's tokens and cost itself, so there is nothing left to draw |
| `oc-models-pro` | `Command` + `Panel` | a second implementation of the table, not the terminal's: a grid, a click to switch, the rows' meaning shared |
| `oc-session-search` | `Command` with `slash` + `Panel` | results in a view, not a block of text |
| `oc-coffee` | `ComposerPill` | the server owns the level and the assertion, so a pill is all the window adds |
| `oc-ponytail-widget` | `ComposerPill` | the level word alone, ordered beside the cup; the four levels are its rows, so the pill is the selector |
| `oc-plugin-updates` | `ComposerPill` | a count when there is something to install, nothing when there is not; the rows are the act |

## The always-visible surfaces

Three, and they are the whole budget for a widget that needs no click: `Slot "session.header"` (one
line, per session), `Slot "window.bottom"` (full width, global), and `ComposerPill` (per session: a menu of
rows, or since 2.2.1 a popover the plugin draws itself through `menu` — the host keeps the capsule, the
placement, the focus and the dismissal, and `rows`/`run` go unused while it is set).

`TitlebarItem` is the fourth, and it takes no content: a round button with an icon, a label that shows on
hover, and a click — the app's own update pill is one. Where it draws depends on the layout, which
*Where a contribution lands* below spells out. Everything else — panels, the panel-end action, menu items,
settings pages, commands — exists behind an affordance.

`tone` colours the **icon**, not the label: a pill without an icon has no colour to show. Icons come
from the app's own set (`branch`, `fork`, `outline-worktree`, …), not from the Nerd Font the TUI uses.

**A `rows` list is as wide as its longest string, and grows to hold it** (measured 2026-10-27: a branch
name padded to 40 characters widened the list instead of truncating). A `menu` popover is the opposite: the
host owns its width, and it is fixed whatever we draw inside (measured on `oc-budget`, whose lines, bar and
rules all live within it). The capsule is the third case: its `label` truncates by contract.

| | `rows` | `menu` |
|---|---|---|
| who draws it | the host | us, inside the host's shell |
| shape | a fixed list of `id`, `label`, `icon`, `tone`, `detail`, `run` | any JSX |
| reacts while open | no | yes, its own reactivity |
| `tone` | exists, colours the row's icon | does not exist: the drawing is ours |
| `detail` | a bordered chip at the row's end — the version on the right, the name on the left | n/a |
| a row with no `run` | shows, and is not clickable | n/a |

So `rows` answers a fixed list where the action is one click, and `menu` answers a surface that needs state
of its own — a bar, an error line, a value that moves while it is open.

**The SDK's `IconName` union is a permission, not a promise.** It is wider than the set the app draws,
and a name that is not there draws a `plus` — no error, no warning, `tsc` satisfied. Confirm the glyph
by eye in the window before relying on it: the day a name is added to the union is not the day it is
added to the app.

## What each surface takes, and where it draws

| surface | content | where it draws | exists |
|---|---|---|---|
| `ComposerPill`, the capsule | a label, **one** icon, `tone` | the row above the composer | per session |
| `ComposerPill`, `menu` | any JSX | a popover under the capsule; the host owns its width, placement, focus and dismissal | while open |
| `Slot "session.header"` | any JSX, one line | the row carrying the app's context ring, token count and session cost | per session |
| `Slot "window.bottom"` | any JSX | a full-width strip above the toasts | always |
| `TitlebarItem` | one icon, a label on hover, a click | the titlebar, or the rail's footer — by layout, below | always |
| `Panel` | any JSX | a tab in the session's side region | per session |
| `Slot "session.panel.end"` | any JSX | the end of the side region's tab strip | per session |
| `Slot "session.location.menu"` | any JSX | inside the location menu | while open |
| `Dialogs.open` | any JSX | above everything, in the host's dialog frame | while open |
| `SettingsPage`, `Command`, `MenuItem` | rows, not drawing | settings, the palette, the host's own menus | always |

Visible without a click: `session.header`, `window.bottom`, the titlebar item, and the capsule. Everything
else is behind an affordance the user opens.

## Where a contribution lands, by layout

The app has three layouts — `appearance.tabLayout` is `horizontal`, `vertical` or `inbox` — and the shell
draws the tab strip for the first alone: the whole condition is `tabLayout !== "horizontal"`. So the two
rows above the timeline are not always both there:

```text
horizontal      ●●●  🔍  [tab] [tab] …  [+]                  ← the titlebar
                progetto / sessione     ◯ 214k · $0.00  ▣  main  ▤   ← the session header

vertical/inbox  ┌ rail ─────┬ progetto / sessione     ◯ 214k · $0.00  ▣  main  ▤
                │ sessioni  │                                 ← the session header, now the first row
                │ …         │
                │ footer    │   ← a TitlebarItem draws here, at the bottom of the rail
                └───────────┴
```

| layout | a `TitlebarItem` draws | `Slot "session.header"` |
|---|---|---|
| `horizontal` | in the titlebar, after the last tab | the row below the titlebar |
| `vertical` | in the footer at the bottom of the left rail | the first row of the content |
| `inbox` | the same footer (measured 2026-10-31) | the first row of the content |
| window under 768 px | back in the titlebar, whatever the layout | above the timeline |

So a widget that must sit beside the app's own context ring, token count and session cost goes in
`session.header`: a figure read at a glance belongs in that row. A titlebar item shares it only in
`horizontal`, and moves to the foot of the rail in the two layouts that hide the tab strip.

The slot also knows when room runs out: `compact` turns true once the title no longer fits beside the
actions, and the contribution shrinks to its icon then.

## A pill never shows a stale value as fresh

A pill's value comes from somewhere that can fail — a server call, a file, a repository — and the two
lazy answers are both wrong: hiding the pill on failure leaves the user with nothing to act on, and
keeping the last value unmarked tells a lie that looks like the truth. Three states instead:

| state | label | tone | title |
|---|---|---|---|
| fresh | the figure, as usual | whatever the figure says | the usual |
| stale — the last good reading is older than two polls | the figure, prefixed `~` | `warning` | what was read, and when |
| nothing ever read, and the source failed | a short word, icon `circle-exclamation` | `danger` | the error itself, and as the menu's only row |

Hiding is not one of them: it is the refusal to say. The terminal half of `oc-budget` has done this since
its first version (`reading…`, `stale 12m`, `budget —`); the window was the one out of line, and it cost
an evening and a morning — every poll a fast 500 from 07:00 to 12:26, the pill gone, nothing to see.

**Where the four pills stand** (each implements it in its own package; there is no shared runtime):

| pill | state |
|---|---|
| `oc-budget` | **all three**, since 2026-10-28 |
| `oc-git` | hides on failure — the next to fix, because a stale count reads as a clean tree |
| `oc-coffee` | keeps the last reading, unmarked |
| `oc-ponytail-widget` | keeps the last value, unmarked |

## An effect belongs to the SDK, not to the half

Upstream banned the raw effect on 2026-10-29: opencode's `.oxlintrc.json` refuses `createEffect`,
`createRenderEffect` and `createComputed` **in `packages/gui-plugins/src`**, the GUI plugins its own team
writes. It does not reach this repository and it is not enforced at load, since a plugin ships a minified
bundle. The public doc says the same thing as advice: *"Prefer these helpers to raw `createEffect`. They
follow a plugin's lifetime and its dependencies' restarts, which hand-written effects tend to get wrong."*

The reason is one sentence: an effect written by hand does not know when to die. The SDK does — a plugin
reloaded, the server restarted, the window closed. `createKeyed(source, fn)` from `@opencode/plugin/gui`
is that version: it re-runs `fn` when the keyed source's value changes, and it is disposed with the owner
that created it. None of ours calls it yet.

**The sites tolerated today** — six calls in five halves. Two of them are in `oc-budget`, which is
unpublished, so its migration costs nothing but rewriting a poller that works; the other four sit in
published packages, where the same change would cost a version for no change in behaviour.

| site | what it does | why it stays |
|---|---|---|
| `oc-git/gui.tsx:22` | one poller for the session on screen: clears and re-arms its timer when the routing moves | published; the poll is per *server*, so the effect re-runs with the session's own |
| `oc-coffee/gui.tsx:29` | the same, per server | published |
| `oc-ponytail-widget/gui.tsx:54` | reads the session, polls every `REFRESH_MS`, cleared by `onCleanup` | published |
| `oc-budget/gui.tsx:154` | one poll per server, plus `refreshNow` for the popover | free to change; the reference migration when the poller is next touched |
| `oc-models-pro/gui.tsx:296` | re-measures the scrollbar gutter when the rows change | published |
| `oc-models-pro/gui.tsx:301` | a `ResizeObserver`, in an effect with nothing reactive in it | published, and a form defect: `onMount` says it |

`scripts/check-source.mjs` fails a `gui.tsx` that imports `createEffect` unless its package is on the
allow-list, so the list can only shrink: a half that migrates must lose its name, and the check refuses a
name that no longer earns it. A listed half whose package has uncommitted changes prints one **note**, so
the migration is remembered at the moment its file is open — silent on every other commit, and gone with
the list. **The limit**: it reads the import, not the calls, so a *new* `createEffect` inside a half already
listed stays invisible. That closes by draining the list, not by counting lines.

**The real risk is not `createEffect`.** It is that `@opencode/plugin/gui` is a provisional contract
(`./gui-experimental`, *Provisional by design*): a helper's signature can move between app releases, and
the lint upstream is a statement of where they are taking it. A migration is therefore worth doing when a
file is already open, never as a campaign.

## Traps

- **Adding `./gui-experimental` to a plugin that is already loaded stays invisible**, however often the
  plugin is reloaded: the set of parts is resolved once per source, when the plugin first appears, and
  neither a file nor a config change recomputes it. A new plugin with the same shape resolves at once;
  an old one needs `opencode service restart`.
- **A rebuilt bundle reaches the open windows on its own** — no window reload, no restart. Every rebuild
  during the model panel's construction appeared live (measured 2026-10-27), and the docs' development
  note says the same. A change that does not appear is a build that did not run, or the trap above: the
  two are told apart by a rebuild fixing the first and only a restart fixing the second.
- **A `tui.js` beside a `tui.tsx` wins, and git does not show it.** The loader resolves a plugin directory
  by file name and does not read `package.json`, so a compiled half left in the repository shadows the
  source: the TUI keeps running that build while the `.tsx` is edited, silently, and `plugins/*/tui.js` is
  ignored so `git status` stays clean. `npm run check` refuses one; the workflow compiles into the package
  it publishes.
- **A header outside a scrolling list is wider than its rows by the scrollbar.** The two are separate
  grids, so the rows lose the bar's width and every column drifts right by it. Do not write a number:
  measure it (`offsetWidth - clientWidth` of the scroller) into a custom property and pad the header
  with it, which is zero where the scrollbars are overlays.
- **`dist/` is generated, never committed**, like `tui.js`: `scripts/build-gui.mjs` builds every plugin
  with a `vite.config.ts`, and the workflow runs it before publishing, so a package can never ship an
  export pointing at a file that is not there. Being ignored, it also **does not move with a branch**: a
  `git switch` leaves the previous branch's bundle in place and the window goes on loading it. Two hooks
  close that: `scripts/hooks/post-checkout` rebuilds when the checkout moved `plugins/`, and
  `scripts/hooks/post-rewrite` rebuilds once a rebase or an amend is over — a rebase checks out the commits
  it replays, so the earlier hook would leave a bundle built from an intermediate commit (measured
  2026-10-31: after a rebase the window drew the previous branch's widget). Enabled once per clone with
  `git config core.hooksPath scripts/hooks`; about a second and a half for all the halves.
- **An `undefined` in an RPC answer is an instant 500, and the widget vanishes.** The output schema is
  JSON: a key that is *present* with `undefined` is neither its declared type nor absent, so the whole
  answer is rejected after the handler ran — in the log a 500 with `http.span=1`, no request made, no work
  done. `JSON.stringify` before returning drops those keys, exactly as the transport would, only before
  validation (`wire()` in `oc-budget`). And the client must keep its last good reading when a poll fails:
  blanking the widget for a whole poll interval is how one bad night empties a panel until noon (measured
  2026-10-28 — every budget poll failed from 07:00 to 12:26, and the pill was gone the whole time).
- **A model pick belongs to a surface, not to the session.** Each surface's picker keeps its own selection:
  a prompt runs with the model of the surface that sent it, and the transcript records that switch, while
  the other surface goes on showing its own. So the two can differ indefinitely, and the next prompt from
  the "wrong" one re-reads the whole context there. Measured 2026-10-29 in both directions, with the native
  picker and `oc-models-pro` alike. It matters to any pill that reads the composer's model: `oc-budget`
  names the wallet of the *previous* model until a turn runs.
- **A `menu` popover is as wide as the composer, whatever its content.** Four builds on 2026-10-29 settled
  it: `max-content`, `width: 100%` and a two-column grid all produced the same box, so the width is the
  host's and no CSS on the content moves it — unlike a `rows` menu, which hugs its longest row. Design the
  contents to fill that width; a narrow layout leaves a column of dead space, and a grid that shrinks a
  track below its content paints over its neighbour.
- **And it clips nothing.** Probed the same day with a 120-character word in the popover: the box did not
  grow, a sentence rewrapped inside it, and the unbreakable word painted straight across the app. A `rows`
  menu is the host's drawing and wraps on its own; a `menu` is the plugin's, so the container needs
  `overflow-wrap: anywhere` — or any error message carrying a URL or a token escapes the panel.

## Where the truth lives

- The SDK's exports, which move: `node -e "console.log(Object.keys(require('./node_modules/@opencode/plugin/package.json').exports).join(' '))"`
- `https://opencode.ai/v2/docs/build/plugins/gui` — registries, host APIs, contracts
- `npm run check` also fails when the SDK's version differs from the running app's, which is how a
  missing export is told apart from an uninstalled one
