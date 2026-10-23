# @rizal72/oc-ponytail-widget

The **ponytail level** in OpenCode v2's prompt footer, right of the coffee cup: a horse glyph, green
while a run is active and grey when idle, then the level word — `off`, `lite`, `full`, `ultra`.

An **unofficial** companion to the [ponytail](https://www.npmjs.com/package/@dietrichgebert/ponytail)
plugin, which is server-only in OpenCode and draws no badge of its own. Install it only if you use
ponytail: with no level file and no shared config it draws nothing, rather than claim a level for a
plugin that is not there.

## Install

```sh
opencode plugin add @rizal72/oc-ponytail-widget
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc` — **after `oc-coffee`**, if you have it, so
the glyph lands to the right of the cup:

```jsonc
"plugins": ["@rizal72/oc-coffee", "@rizal72/oc-ponytail-widget"]
```

## What it reads

The level, from the same two sources ponytail reads and in the same order:

1. `~/.config/opencode/.ponytail-active` — what `/ponytail <level>` writes;
2. `~/.config/ponytail/config.json` — the shared default that pi and OpenCode both read.

It writes nothing: a badge that could contradict the ruleset actually in the prompt would be worse than
no badge.

Two notes. The glyph is `md-horse_variant`, because Nerd Fonts has no ponytail glyph. And the state file
is re-read when a run starts, so a level set with `/ponytail lite` appears on the turn that command
triggers.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
