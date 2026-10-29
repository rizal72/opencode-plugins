# Desktop GUI plugins — the record

A GUI plugin draws inside OpenCode Desktop: panels, commands, settings pages, slots, composer pills,
titlebar items, native menus. It is the third part of a plugin package, shipped as
**`./gui-experimental`** beside the server part and the TUI part.

## Provisional by design, and re-read on every release

The `-experimental` is not decoration: a shape here can change between app releases, and we accepted that
to have the surfaces at all. So our GUI halves are **provisional on purpose** — they work and they ship,
but the day one breaks it is a shim to rewrite, not a regression we owe anyone. The terminal halves are
the stable product; the GUI halves ride on the experimental API.

Every app release, two questions — the first is a gate, the second a reading:

1. **Does anything break?** `npm run check` fails when the SDK's version differs from the running app's, so
   a renamed export or a moved shape surfaces before a plugin does.
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
| `oc-context` | `Slot "session.header"` | percent and window beside the app's token count |
| `oc-models-pro` | `Command` + `Panel` | a second implementation of the table, not the terminal's: a grid, a click to switch, the rows' meaning shared |
| `oc-session-search` | `Command` with `slash` + `Panel` | results in a view, not a block of text |
| `oc-coffee` | `ComposerPill` | the server owns the level and the assertion, so a pill is all the window adds |
| `oc-ponytail-widget` | `ComposerPill` | the level word alone, ordered beside the cup; the four levels are its rows, so the pill is the selector |

## The always-visible surfaces

Three, and they are the whole budget for a widget that needs no click: `Slot "session.header"` (one
line, per session), `Slot "window.bottom"` (full width, global), and `ComposerPill` (per session: a menu of
rows, or since 2.2.1 a popover the plugin draws itself through `menu` — the host keeps the capsule, the
placement, the focus and the dismissal, and `rows`/`run` go unused while it is set). `TitlebarItem` is
documented as always visible and drew nothing in a vertical-tabs
window, where the titlebar holds only the traffic lights. Everything else — panels, the panel-end
action, menu items, settings pages, commands — exists behind an affordance.

`tone` colours the **icon**, not the label: a pill without an icon has no colour to show. Icons come
from the app's own set (`branch`, `fork`, `outline-worktree`, …), not from the Nerd Font the TUI uses.

**A row is as wide as its longest string, and the menu grows to hold it** (measured 2026-10-27: a branch
name padded to 40 characters widened the panel instead of truncating). So nothing of ours needs a cap;
the only width we control is the capsule, whose `label` truncates by contract.

**The SDK's `IconName` union is a permission, not a promise.** It is wider than the set the app draws,
and a name that is not there draws a `plus` — no error, no warning, `tsc` satisfied. Confirm the glyph
by eye in the window before relying on it: the day a name is added to the union is not the day it is
added to the app.

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

## Eight traps

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
  ignored so `git status` stays clean. `npm run check` refuses one; the mirror compiles into the mirror.
- **A header outside a scrolling list is wider than its rows by the scrollbar.** The two are separate
  grids, so the rows lose the bar's width and every column drifts right by it. Do not write a number:
  measure it (`offsetWidth - clientWidth` of the scroller) into a custom property and pad the header
  with it, which is zero where the scrollbars are overlays.
- **`dist/` is generated, never committed**, like `tui.js`: `scripts/build-gui.mjs` builds every plugin
  with a `vite.config.ts`, and `scripts/mirror-public.sh` runs it before copying, so a package can never
  ship an export pointing at a file that is not there.
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
