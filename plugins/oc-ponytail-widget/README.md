# @rizal72/oc-ponytail-widget

The **ponytail level**, in the prompt footer and in the desktop app.

An **unofficial** companion to the [ponytail](https://www.npmjs.com/package/@dietrichgebert/ponytail)
plugin, which is server-only in OpenCode and draws no badge of its own. Install it only if you use
ponytail: **with that plugin not installed it draws nothing**, on either surface, rather than claim a
level for a package that is not there.

## Install

```sh
opencode plugin add @rizal72/oc-ponytail-widget
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc` — **after `oc-coffee`**, if you have it, so the
glyph lands to the right of the cup:

```jsonc
"plugins": ["@rizal72/oc-coffee", "@rizal72/oc-ponytail-widget"]
```

## Update

V2 checks package plugins at startup and never applies the update, so a package only moves when you ask:

```sh
opencode plugin check     # which of the installed packages are behind
opencode plugin update    # apply them, and let the server reload
```

Or install [`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates): the
count appears in a pill above the composer, with the update one click away.

## TUI

A horse glyph in the footer, right of the coffee cup, then the level word — `off`, `lite`, `full`, `ultra`.
The glyph is `md-horse_variant`, because Nerd Fonts has no ponytail glyph.

## GUI

A pill above the composer: the level as the capsule, the four levels as its rows — a selector the terminal
never had. Picking one writes `~/.config/opencode/.ponytail-active`, the file `/ponytail <level>` writes
too, so the next turn reads that level.

## How it works

The level comes from the same two sources ponytail reads, in the same order:

1. `~/.config/opencode/.ponytail-active` — what `/ponytail <level>` writes;
2. `~/.config/ponytail/config.json` — the shared default that pi and OpenCode both read.

With neither, it shows the package's own default, `full`. Both surfaces re-read every two seconds, so a
level set in the terminal appears in the window and the other way round.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
