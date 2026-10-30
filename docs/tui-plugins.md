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
