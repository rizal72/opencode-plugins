# oc-context

The **Context block in the sidebar**, with the one thing OpenCode's own block leaves out: the window its
percent is a percent of.

**Terminal only.** There is no desktop half, because the block it replaces does not exist there.

```
Context
409,907 tokens
41% used of 1.0M
$2.18 spent
```

## Install

Not a package on npm: it **replaces a built-in**, so it takes two lines, one in each file.

```jsonc
// ~/.config/opencode/cli.json — switch the built-in off, or the sidebar would carry both
"plugins": ["-opencode.sidebar.context"]
```

```jsonc
// ~/.config/opencode/opencode.jsonc — load this one from the clone
"plugins": ["../opencode-plugins/plugins/oc-context"]
```

A built-in is one unit: it can be switched off or taken over, never added to. This one costs nothing,
because the whole block is redrawn here — unlike the prompt footer, where switching off the built-in
would take the child-session chip and the `agents` and `esc` hints with it.

## What it shows

| line | text | when |
|---|---|---|
| 1 | `Context` | always |
| 2 | `{tokens} tokens` | there is usage |
| 3 | `{percent}% used of {window}` | there is usage and the window is known |
| 4 | `{cost} spent` | the cost is above zero |

The count is the last assistant message carrying tokens, skipping anything before the last compaction and
anything after a revert point: `input + output + reasoning + cache.read + cache.write`. The percent is a
percent of **the model's own window**, the same rule the footer figure uses, so the two cannot disagree.
With nothing measured and nothing spent the block does not appear, which is the built-in's own behaviour.

## Colour

Green normally, yellow from **60%** of the window, red from **80%** — a percent, so a smaller window warns
on its own scale. Only the count and the percent take the colour; the labels, the heading and the cost stay
muted, and the window wears the theme's accent. The tokens are the ones `oc-budget` uses, so the sidebar
has one palette and not one per widget.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
