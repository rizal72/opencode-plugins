# oc-ponytail-widget — the record

The ponytail level in the prompt footer, **to the right of the coffee cup**: `󱗁 full`. The glyph carries the
level's colour — `off` dim, `lite` yellow, `full` green, `ultra` red — and the level word stays dim and
carries the setting. It is always visible **while ponytail is installed**, `off` included, because this
surface has no click to bring a level back; with no ponytail at all it draws nothing, and *Installed or
not* below says why.

**The colour was an analogy, and it was wrong.** Until 2026-10-28 the glyph was green while a run was
active, "the cup's own rule" — but the cup's rule means "the assertion is up", and `caffeinate` really
does stop between turns while the level does not. pi never blinked either: its ponytail is a footer status
key (`externalStatusKey` in `pi-footer.json`), not a lighting badge. So the colour now says which level is
in force, which is the fact this widget exists to report, and the cup keeps saying whether work is running.

On the desktop the same level is a **pill in the composer row**, at `order` 6 — beside the coffee cup, as
in the footer — showing the level word alone, with the four levels as the rows behind it: the pill is
the selector the terminal never had. The icon is `glasses`: the icon set has neither a horse nor a
ponytail, and the horse was a Nerd Font stand-in. A click writes the state file, so the pill and
`/ponytail lite` produce the same state, and both surfaces read it back.

**`full` is shown, not assumed**: with neither file configured the widget shows `full`, because `full` is
the level the package itself would run. An earlier rule (2026-10-22) hid both surfaces in that case,
reasoning that a widget shipping on its own must not claim a level nobody set; the owner reversed it on
2026-10-27 — the widget exists to say what ponytail is doing, and the package's own default *is* what it
does. What that paragraph could not see was a machine with no package at all, and it is not the same case:
that one is now read from the host, and *Installed or not* is the rule.

Config: the plugin path in `~/.config/opencode/opencode.jsonc`, listed **after `oc-coffee`** so the
glyph lands to its right. Nothing in `cli.json`: no built-in is switched off.

## Why it is ours

The OpenCode half of the ponytail package is **server-only** — `.opencode/plugins/` holds
`index.js`, `ponytail.mjs` and a frontmatter parser, no TUI part at all (measured 2026-10-17, on
5.3.2). On pi the badge comes from the extension itself, which publishes a status key
(`ui.setStatus("ponytail", …)`) that pi's footer draws — that mechanism does not exist here, so the
badge does not exist here either.

## The glyph

**`md-horse_variant` (U+F15C1)**. Nerd Fonts has **no ponytail glyph**: checked against its own
`glyphnames.json`, where `pony`, `tail`, `hair`, `mane`, `braid` and `comb` return only the Tailwind
logo, `linux-tails`, a hairdryer and words like `chair`/`wheelchair` that merely contain the letters.

Two ranges decide what is usable, and they are not equal: `md-*` lives in **plane 15**
(`U+F0001–U+F1AF0`) and renders everywhere; `fa-*` horses sit at `U+E000–U+F8FF` and are **not covered
by the owner's font in every rendering path** — observed in the transcript, where the Font Awesome
horses vanished and the Material Design ones did not (2026-10-17). Plane 15 it is.

## Where the level comes from

The package's own order, which is two files and an environment variable — read in **one place**, the server
half (`index.ts`). The badge asks it over `rpc.ts` instead of reading the files itself: one answer, two
renderers, so the two surfaces cannot drift.

1. `~/.config/opencode/.ponytail-active` — `readMode()` in `.opencode/plugins/ponytail.mjs`: the state
   file, plain text, the word alone. This plugin writes it from the desktop pill.
2. `PONYTAIL_DEFAULT_MODE` — the first thing `getDefaultMode()` looks at in `hooks/ponytail-config.js`
3. `~/.config/ponytail/config.json` → `defaultMode` — the one file pi and OpenCode share; read only here
4. `full` — the package's hardcoded last resort

**One deliberate deviation**: step 2 is skipped — the package documents `PONYTAIL_DEFAULT_MODE` as the
variable to avoid, and it outranks the config. The consequence, stated so it is not found by accident:
with that variable set the prompt runs at its level while both surfaces show the file or the config.
Three lines to add if it ever comes back into use. Step 4 is **shown**, not hidden: `full` is what the
package would run, so reporting it is the truth this widget exists for.

The state file is ours to write as well, from the desktop pill: `~/.config/opencode/.ponytail-active`,
plain text, the word alone, no trailing newline (the format `/ponytail` writes — measured 2026-10-27).
The shared config is **read only** now: it is the package's default, and editing it would have moved pi's
level too. Both surfaces read the same chain, so the pill and the badge can never disagree about what is
on disk.

`PONYTAIL_DEFAULT_MODE` is deliberately **not** consulted: the package documents it as the variable to
avoid, because it outranks the config file and silently defeats `/ponytail default`. Adding it to the
chain is three lines if that ever changes.

**The level is polled, not announced**: the badge used to re-read it when a run started, by subscribing to
`session.execution.*` — names the TUI bus stopped emitting, which left the badge reading a stale level.
Both surfaces now ask on a clock — 2 s, the cup's cadence — and nothing else: no run state,
no `session.status`, no event name left to rot. A level set with the pill shows in the
terminal within two seconds, and vice versa.

## Installed or not

`full`, `off` and "no ponytail" are three different facts and the level files can only express two, so the
third comes from the host: `ctx.plugin.list()` in `index.ts`, the registry the app itself reports
(`opencode api get /api/plugin` returns the same list). An entry is ponytail when its id is `ponytail`, its
source is the package `@dietrichgebert/ponytail`, or it is a `local` install whose folder is named
`ponytail`; it counts only with `state.status === "active"`, so a package that failed to load is as absent
as one that is not there.

- **Asked at most once a minute**, from inside `setup()`, and the answer is kept. The registry moves on a
  config save, not on a clock tick; without the cache the 2 s poll would become sixty registry reads a
  minute for a fact that changes weekly.
- **A failed call changes nothing**: `installed` starts `true`, and only a definite answer moves it. A
  registry that cannot answer must not hide a level that is in force.
- **False means nothing is drawn**, on either surface, and the state file is left as it is — it is the
  user's, and it becomes valid again the moment the package is installed.

Why nothing rather than a word: `off` is a level the package applies, so a badge reading `off` for a missing
package would say the same thing for two different situations. Same reason on the desktop, where a pill
would additionally offer four rows that write a file no package reads.

## The server half

`index.ts` holds the two calls across the split — `ponytail.state` and `ponytail.set` (`rpc.ts`) — because
the level is a file and a window has no filesystem, and it is the **only** reader of the level, of the
shared config and of the registry: the badge goes through it too. `set` writes the state file with a
tmp-and-rename; the shared config is never written.

## Desktop half

A `ComposerPill`: `glasses` and the level word alone (`full`), `order` 6 so it lands beside the coffee cup
as the footer badge does. The icon carries the level's colour, the same table as the terminal — `off` takes
none, `lite` warning, `full` success, `ultra` danger — because the pill contract has exactly three tones
and `off` is not a warning, it is nothing. The four levels are the rows, the one in force carrying a
**green check** — a state, not a label, so it is coloured like the capsule. A click writes the state file
and the pill updates from the answer, not from the click.

The window polls every 2 s, like the cup: the level is a file, `/ponytail` writes it from outside, and
nothing tells the window otherwise. A read in flight never overrides a click — the click's answer is the
newer one — and while ponytail is installed the pill always has a level to show, `full` included. With it
missing the pill is not drawn at all (*Installed or not*), so no row can write a state nothing applies.

## Publishing

Publishable as it stands: it reads two config files the ponytail plugin owns, keeps no paths of its own
and nothing personal. The package is `@rizal72/oc-ponytail-widget`, and since 2026-10-22 the directory and
the plugin id carry the same name: the `oc-` family, plus `-widget` to say this is a badge *for* ponytail
and not the plugin itself — the README opens with "unofficial" for the same reason. Separate on purpose:
it imports nothing from that package, so their release calendar cannot break it, and a badge of their own
would sit beside it, not replace it.

Published as `@rizal72/oc-ponytail-widget@0.1.0` on 2026-10-22, `0.1.1` on 2026-10-25 with the compiled TUI
half; procedure in `docs/publishing.md`. **The desktop half and the write are unreleased**: the next
version is the first that ships a `gui-experimental.cjs` and an `rpc` export, and it should be published
only after the terminal's rewrite has run in the wild for a day.
