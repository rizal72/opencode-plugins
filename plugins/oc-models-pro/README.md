# @rizal72/oc-models-pro

A model picker for OpenCode v2 that shows what a request costs, not just a list of names.

It lists every model with its input and output price, context window, intelligence index, `tok/s`
when a source has it, the Go credit multiplier, and the effective price per request; it sorts by
what a request actually costs and switches the model on Enter.

## Install

```sh
opencode plugin add @rizal72/oc-models-pro
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-models-pro"]
```

## Use

`/models-pro`, or `Ctrl+X` then `p` (the `<leader>p` bind), or the command palette — inside a session.

| key | does |
|---|---|
| `↑` `↓` | move the selection |
| `Enter` | switch to the model and close |
| `ctrl+o` | sort: effective, in, out, in+out, ctx, int, speed, recent, name |
| `ctrl+s` | scope: all → favourites → paying |
| `ctrl+g` | provider groups on/off |
| `ctrl+f` | favourite on/off |
| `ctrl+u` | clear the search |
| `esc` | clear the search, else close |

## What it reads

- prices and context from the host's own catalogue;
- the intelligence index from `catalog.stencil.so`, cached six hours;
- the Go credit from OpenCode's Go plan page, cached one day — `opencode-go` models only;
- favourites and recent models from the app's own `~/.local/state/opencode/model.json`, so they are
  the same ones the native picker keeps.

No API key is needed, and nothing leaves the machine except those two public fetches.

## One caveat

A plugin still cannot pick the model directly, so the panel switches it the long way: it borrows the
app's own switch command and restores what it borrowed a moment later. There is an open issue upstream
([anomalyco/opencode#57771](https://github.com/anomalyco/opencode/issues/57771)) that would let a plugin
do it in one call — when it lands, the workaround goes and nothing else changes.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
