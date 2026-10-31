# The sidebar — slots, order, and who draws what

**Subject: the session sidebar.** The plugin that owns the most of it is `oc-context`; the record there
is about the context block, this one is about the sidebar itself.

## Every block is the same slot

The sidebar has two slots a plugin can draw in, and one that is not a slot at all:

| slot | who draws there |
|---|---|
| `sidebar.content` | **everything**: the built-in MCP block, the built-in todo block, the built-in context block, and ours |
| `sidebar.footer` | the bottom of the sidebar, below the content |
| — | the host's own content, composed **before** `sidebar.content` |

Inside one slot the order is the **enable order**: the built-ins first, then the local plugins in the
order of the `plugins` list. So a plugin that appends lands *under* the built-ins, whatever its place in
the config. Measured 2026-10-20: our context block was third, under MCP and todo, and no reordering of
the `plugins` list moved it.

## The four placements

| placement | where the claim lands |
|---|---|
| `prepend` | first **inside** the slot's boundary |
| `append` | last inside the boundary — the default for a built-in |
| `before` / `after` | siblings **outside** the boundary, adjacent to it |
| `replace` | takes the slot over: the original content and every claim inside it are suppressed |

`before` and `after` are the only ones that put a claim outside the boundary, and `replace` is the only
one that removes what was there.

## Ours

`oc-context`, `oc-git`, `oc-budget` and `oc-plugin-updates` **prepend** to `sidebar.content`, so they sit
above the built-in MCP and todo blocks. The built-ins keep the order they have among themselves — that is
the host's, not ours. The four of ours keep the order they are enabled in.

## The built-in context block

`opencode.sidebar.context` is a built-in plugin, switched off in `~/.config/opencode/cli.json` with
`-opencode.sidebar.context`, and redrawn by `oc-context`. The whole of it is **one render** — a box of
four lines with no slot inside it — so a line cannot be added to it from outside: it can only be replaced
or switched off. Its contribution to `sidebar.content` is that block and nothing else, so switching it
off costs nothing we do not redraw.

Two mechanisms that must not be used here: `replace: "sidebar.content"`, which would take the sidebar's
other contents down with it, and leaving the built-in on beside ours — two blocks saying the same thing,
one of them without the window.
