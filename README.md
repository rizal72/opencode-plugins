# OpenCode plugins

Plugins for OpenCode v2, built for my own workflow and published because they turned out useful to others.
The sources are here to be read and forked.

Each one says what it does in **the terminal**, in **the desktop app**, or in neither (a tool that only the
agent calls). One plugin, one state, two surfaces, GUI and TUI:

![The same plugins in the terminal and in the desktop app](screenshots/demo.webp)

| plugin | what it does | TUI | GUI | npm |
|---|---|---|---|---|
| [`@rizal72/oc-models-pro`](plugins/oc-models-pro/README.md) | `/models-pro`: every model with its price, context, intelligence index, tok/s and the Go credit | ✓ | ✓ | ✓ |
| [`@rizal72/oc-budget`](plugins/oc-budget/README.md) | the paying provider's budget: sidebar, footer, `/budget` | sidebar, footer, `/budget` | the Go percentage and its ring in the session header, with a popover | ✓ |
| [`@rizal72/oc-plugin-updates`](plugins/oc-plugin-updates/README.md) | update OpenCode plugins: one by one or all of them at once | a line in the sidebar, and a dialog on `/plugin-updates` | a pill above the composer | ✓ |
| [`@rizal72/oc-notify`](plugins/oc-notify/README.md) | a notification on the phone when a turn ends | none | a settings page for the four choices | ✓ |
| [`@rizal72/oc-git`](plugins/oc-git/README.md) | the repository: branch, the three counts, ahead/behind | sidebar, and the counts in the footer while dirty | a pill above the composer | ✓ |
| [`@rizal72/oc-coffee`](plugins/oc-coffee/README.md) | keeps the Mac awake while the agent or a command is working (macOS only) | cup badge in the footer, `/coffee` | a cup in the session header, with the four levels | ✓ |
| [`@rizal72/oc-ponytail-widget`](plugins/oc-ponytail-widget/README.md) | the ponytail level | badge in the footer | a pill, and the only selector | ✓ |
| [`@rizal72/oc-session-search`](plugins/oc-session-search/README.md) | `session_search`: keyword search over the transcripts of past sessions | none | none | ✓ |
| [`@rizal72/oc-tps-meter`](plugins/oc-tps-meter/README.md) | tokens per second, step by step: each step's speed, with the median, the peak and the wait for the first token | none | a gauge in the session header, and a side panel with a bar chart, one bar per step, scrolls sideways | ✓ |
| [`oc-context`](plugins/oc-context/README.md) | the Context block in the sidebar, with the window its percent is a percent of | sidebar | none | none |
| [`oc-donsetch`](plugins/oc-donsetch/README.md) | keeps the `donsetch` binary current | none | none | none |

Something broken? Open an issue: https://github.com/rizal72/opencode-plugins/issues. Paste the error line
and the opencode version. That is the whole form.

A plugin that **vanishes after an update** (`opencode plugin list` no longer shows it, and it draws nothing)
is a server that reloaded plugins while the package was being replaced, and skipped the entry without
saying so. Restart it with `opencode service restart`: nothing is lost, and the plugin comes back.

## Install

```sh
opencode plugin add @rizal72/oc-models-pro
opencode plugin add @rizal72/oc-budget
opencode plugin add @rizal72/oc-plugin-updates
opencode plugin add @rizal72/oc-notify
opencode plugin add @rizal72/oc-git
opencode plugin add @rizal72/oc-coffee
opencode plugin add @rizal72/oc-ponytail-widget
opencode plugin add @rizal72/oc-session-search
opencode plugin add @rizal72/oc-tps-meter
```

These install the version current today and keep it. Add `@latest` to a name, or a range such as
`@^1.2.0`, and the package follows its own releases instead, which OpenCode applies by itself from OpenCode
version 2.4.0 on; a Git plugin follows a `#branch` the same way (`Update` below).

Each plugin directory is a package of its own: a `package.json`, an `index.ts` for the server half, a
`tui.tsx` for the terminal and a `gui.tsx` for the desktop app where one exists. The server half owns the
state; the two halves that draw only display it, which is why the same facts hold on both surfaces.
`npm run check` type-checks all of them.

## Update

Until OpenCode version 2.4.0, V2 checked package plugins at startup and never applied the update, so a
package only moved when you asked. From OpenCode version 2.4.0 a plugin that names what to follow moves by
itself: `name@latest`, a range such as
`name@^1.2.0`, or a Git branch such as `github:acme/plugin#main` is checked at startup and every 24 hours,
installed and reloaded in place, and a version that fails to load leaves the previous one running.

A bare name, a tag such as `@next`, a Git tag and an exact version stay where they are, and those move by hand:

```sh
opencode plugin check     # which of the installed packages are behind
opencode plugin update    # apply them, and let the server reload
```

Or install [`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates): the
count appears in a pill above the composer, with the update one click away.

The ones marked `none` in the npm column are here to be read: `oc-context` takes over a built-in and needs a
line in `cli.json`, and `oc-donsetch` only updates a binary you install yourself, so neither is a package.
The rest install with `opencode plugin add`, and `oc-notify` asks for one thing more: the free ntfy app on
the phone.

Where these came from: [Why I left OpenCode for Pi, then came back for v2](https://www.reddit.com/r/opencodeCLI/comments/1xcgnpr/why_i_left_opencode_for_pi_then_came_back_for_v2/).

Speed figures that `models-pro` shows with a `~` come from [Artificial Analysis](https://artificialanalysis.ai/), used under their free API terms.
