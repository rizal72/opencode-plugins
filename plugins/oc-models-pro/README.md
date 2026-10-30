# @rizal72/oc-models-pro

A model picker that shows what a request costs: price in and out, context, intelligence, `tok/s` and the
Go credit, sorted by what a request actually costs. Enter switches.

## Install

```sh
opencode plugin add @rizal72/oc-models-pro
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-models-pro"]
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

`/models-pro`, or `Ctrl+X` then `p`, inside a session.

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

## GUI

The same table as a side panel: `mod+shift+m`, `/models-pro`, or the session menu. Click a column to sort
by it, a star to favourite, a row to switch. The search box, the scope buttons and a refresh sit above it.

## How it works

| column | source |
|---|---|
| price, ctx | the host's own catalogue |
| int | catalog.stencil.so, cached 6 h |
| tok/s | this machine's own sessions: last 7 days, or all history when that window is thin |
| ~tok/s | Artificial Analysis, with a free key |
| cred | the Go plan page, cached 1 day, `opencode-go` only |

Favourites and recents are the native picker's (`~/.local/state/opencode/model.json`), so both agree. The
switch is the app's own path, never a write to the session or that file.

## Optional: tok/s for models you have not run

`tok/s` is measured from your own sessions, so a model you never used has no number. A free key from
<https://artificialanalysis.ai/> (1,000 requests a day) fills those cells with a `~`:

```sh
# macOS and Linux, zsh or bash
echo 'export ARTIFICIAL_ANALYSIS_API_KEY="your-key"' >> ~/.zshrc && source ~/.zshrc
```

```powershell
# Windows
setx ARTIFICIAL_ANALYSIS_API_KEY "your-key"
```
