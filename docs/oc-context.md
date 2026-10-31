# oc-context — the record

The **context block in the sidebar**: the lines OpenCode's own `opencode.sidebar.context` prints
there —

```
Context
409,907 tokens
41% used
$2.18 spent
```

— plus the one thing that block leaves out: **the window the percent is a percent of**
(`41% used of 1.0M`). The operative summary is in the README's plugin table; this is the record.

Config: a **disable directive** in `~/.config/opencode/cli.json`:

```jsonc
"plugins": ["-opencode.sidebar.context"]
```

and the plugin path in `~/.config/opencode/opencode.jsonc`. It reaches the top of the sidebar with
`prepend`; the mechanism, the measurement and the built-in block it replaces are in `docs/sidebar.md`.

## Why the built-in is taken over, not complemented

The whole of `opencode.sidebar.context` is **one render** — a box of four lines with no slot inside it —
so a line cannot be added to it from outside: it can only be replaced or switched off, and switching it
off costs nothing we do not redraw. The two mechanisms that must not be used here, and the measurement
behind them, are in `docs/sidebar.md`.

**The prompt footer is the opposite case, and it is the lesson worth keeping.** There, switching off the
built-in to replace a single figure took the **child-session chip**, the `agents` hint and the `esc` hint
with it, silently, because they lived in the same render (2026-10-17). A built-in is one unit: the
question before disabling one is not "what does it print that I want to change" but "what **else** does it
print". The prompt footer is therefore left alone, and its figure (`409.9K (41%)`, no total) lives next
to nothing of ours.

## The block

| line | text | when |
|---|---|---|
| 1 | `Context` — bold, `text.base` | always |
| 2 | `{tokens}` + ` tokens` — thousands separators, as the built-in prints them | when there is usage |
| 3 | `{percent}% used` + ` of {window}` | when there is usage and a known window |
| 4 | `{cost} spent` — USD | when the cost is above zero |

The whole block is **hidden while there is no usage and no cost**, which is the built-in's own
behaviour: on a session with nothing measured, that block does not exist and neither does ours.

Every row is one `text` in a column `box`; the colour boundary inside a row is a `span` with
`style={{ fg }}` — the shape the built-ins use — not a `fg` prop on nested elements.

## The figure

A port of the TUI's own `xr` + `b$`:

- the message is the **last assistant** one carrying tokens, skipping anything before the **last completed
  compaction** and anything after a **revert** point;
- the count is `input + output + reasoning + cache.read + cache.write`;
- the percent is `round(used / model.limit.context * 100)` — the same rule the footer figure uses, so the
  two can never disagree;
- the window comes from the model in the location's model list; when nothing is measured yet, from
  `session.model` — the model the next request will use.
- the same count is also **what colours the block**: the thresholds are a **percent of the model's own
  window**.

## Colour

**The same rule as the other widgets**: **green normally, yellow from 60% of the window, red from 80%**.
The level is a **percent of the model's own window**, so a smaller window warns on its own scale. The
previous rule was absolute (600K / 800K used), and that had a hole: on a model whose window is smaller
than 1M it never fired — 200K used of a 200K window was still grey. The percent rule closes it.

Only the **token count** and the **percent** take the colour; their labels (` tokens`, `% used`, ` of`),
the `Context` heading and `$… spent` stay muted. The **window** (`1.0M`) is not a state but a value: it
wears the theme's **accent**, the same blue as the branch name in `oc-git`.

| | first choice | fallbacks |
|---|---|---|
| green | `syntax.string` | `diff.text.added` → `text.feedback.success` |
| yellow | `text.feedback.warning` | `syntax.type` → `syntax.number` |
| red | `diff.text.removed` | `syntax.keyword` → `text.feedback.error` |
| accent | `syntax.function` | `syntax.variable` → `text.base` |
| muted | `text.muted` | `text.faint` → hex |

The green, the yellow and the red are the **same tokens `oc-budget` uses** and the accent is the **same
one `oc-git` uses**: one palette for the whole sidebar, not one per widget. Chosen by eye across
several themes, hunting for tokens that keep the same *kind* of colour everywhere, since the theme names
roles and not colours. Two earlier passes are worth remembering because each looked right in one theme
and wrong in the next: `syntax.type` as the yellow (too pale) and `text.feedback.error` as the red.

## The footer, which is not ours (measured 2026-10-17)

Read out of the compiled binary, because none of it is documented: there are **two footer rows**, and
they have nothing to do with each other.

- **`prompt.footer`** — the line under the prompt input, on **every screen that has a prompt, the start
  page included** (that page *is* the same input, centred and narrower). The row is
  `justifyContent: space-between`, and it has exactly **three children**:

  | child | what it holds |
  |---|---|
  | `prompt.footer.status` | a box `flexGrow 1 · flexShrink 1 · minWidth 0` that reports its own width back to the app (`onSizeChange`). Inside it, in order: the working **spinner** + interrupt hint (while a turn runs), the **progress** dots line, `(new worktree)`, and the **folder** (`prompt.footer.location`, muted, hoverable, `truncate`) — then everything **plugins append**: `oc-budget`'s wallet and `oc-coffee`'s cup live here, and the built-in `/btw` badge. |
  | `prompt.footer.file` | the **attached file** chip, only while a file is attached (`truncate`, `flexShrink 1`, accent while pending) |
  | `opencode.prompt.footer`'s own render | the child-session chip (`[key] · N subagents · N shells`, clickable → the first child), then ` · `-joined **context figure and cost**, then the `[key] agents` and `[key] commands` hints, and `esc exit shell mode` in shell mode. Its figure is `compact tokens (percent)` — **no window**, which is why the window lives in the sidebar block instead. |

  Two things about that third child: its figure and cost are dropped entirely when the row is tight
  (`width - 8` of slack, then the shortcuts alone), and on a session with no usage and no cost it prints
  **nothing** — a zero figure there would be new behaviour, not a restoration.

  The chip's counts come from `session.family(id)` filtered on `status === "running"` (minus the session
  itself) and from `shell.list(location)` filtered on this session, and the key is
  `keymap.shortcuts("session.child.first")`. That is what makes it clickable, and it is why it cannot be
  rebuilt piecemeal once its plugin is off — the click dispatches `session.child.first` through the same
  keymap.

- **`home.footer`** — the start page's own bottom line, drawn by the built-in `opencode.home.footer`
  (`width 100%`, padding 2, `flexShrink 0`, gap 2), and **only when the viewport is at least 14 rows and
  44 columns**. Five children, left to right:

  | child | when it appears | notes |
  |---|---|---|
  | MCP indicator | only if MCP servers are configured | `⊙ N MCP` — red if any failed, green from one connected, muted at none; clickable → the MCP list; `/mcps` hint from 64 columns |
  | plugin-failure indicator | only if a plugin failed to load | `⊙ N plugin failed`; `/plugins` hint from 80 columns |
  | `home.footer.status` | — | **empty**: nothing appends to it |
  | spacer | — | `flexGrow 1` |
  | version | from 64 columns | muted, right |

  All five `flexShrink: 0`. On a quiet terminal the row is just the version, far right.

**On the owner's worry** — that one more widget in a footer row would end up overlapping. Overlap is not
what that layout invites: the flexible box takes the leftover room and the row is `space-between`, so a
crowded footer gives way rather than stacks. The failure mode it *does* invite is **clipping**, and the
built-ins answer it in one of exactly two ways, never a third:

| the element | how it is pinned |
|---|---|
| must not be squeezed | `flexShrink: 0` — the MCP badge, the plugin-failure badge, the version, the child-session chip, the built-in `/btw` badge |
| may give way | `flexShrink: 1` **+ `truncate: true` + `wrapMode: "none"`** — the folder, the file chip, the `(new worktree)` note |

## The server half is empty

`index.ts` exports a plugin whose `setup` does nothing. It exists because the loader resolves a plugin
directory by entry file names (`index`/`server`, `tui`, `rpc`) and a missing server entry fails the whole
load — so a TUI-only plugin still needs the file.
