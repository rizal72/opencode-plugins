# Terminal TUI plugins — the record

A TUI plugin draws inside the terminal: sidebar lines, footers, dialogs, panels, commands, routes. It is
the second part of a plugin package, shipped as **`./tui`** beside the server part, and it is the stable
half of ours — the GUI ones ride on an experimental API (`docs/gui-plugins.md`).

What a terminal shares with the desktop window — one server and many clients, the dev switch, and the fact
that nothing draws before a session has a prompt — is in `docs/plugin-surfaces.md`. This record keeps only
what is the terminal's own.

## A command is invisible without `mode: "global"`

`keymap.layer` defaults to `mode: "base"` — the SDK type: *"Limits the layer to one OpenCode input mode. Use
global to opt out; defaults to base."* A command registered without `mode: "global"` exists, is dispatched
by nothing, and never reaches the palette or the slash completion — while the slot beside it draws
normally, so the half looks loaded. The official guide passes `mode: "global"` in every example. Measured
2026-10-30 on `plugins/oc-plugin-updates/tui.tsx`, where `/plugin-updates` had never been listed since it
was written; `oc-coffee`, `oc-budget` and `oc-models-pro` all pass the mode and were unaffected.

## Pointer events

A click is a `down` **and** an `up`; OpenTUI synthesises no `click` event, and both handlers are documented
(`Interaction`, 0.8.0). A row opens a modal on the **release**, not on the press: the press opens it under
the pointer, and the release that follows lands outside the new modal and closes it again.

## A dialog row is one line, and `disabled` hides it

`ui.dialog.select` draws each option on **one** line — `title`, then `description` — and does not wrap: a row
wider than the panel is cut at the right edge. Measured 2026-11-03 on `oc-coffee`'s level menu, where
`System — no sleep at all, and macOS counts you as active` lost its tail at the panel's width. The fix is a
one-word `title` and a detail short enough that the cut can only ever eat the detail.

Two properties of the option shape are worth writing down, because the types do not say them:

- `disabled: true` **removes** the option. It is not drawn greyed out and out of reach; it is not drawn at
  all. The only hint is the note on `search` — "receives only enabled options" — which reads like a filter
  of the list rather than of the display.
- `category` is what separates rows into groups; without it every option is one flat list.

`current` marks the option carrying that value, with a dot in the margin. That is how a menu shows the state
it is setting without a second panel, and it is what makes a separate "status" command unnecessary: the menu
already answers it.
