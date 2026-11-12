# oc-donsetch

Keeps the [`donsetch`](https://www.npmjs.com/package/donsetch) binary current: **once a day**, on the first
prompt after the date changes.

**Terminal and desktop alike** — it draws nothing. It is a tool the agent calls, not a surface.

## Install

The plugin **does not install the binary**. That is the one step to remember, and it is separate:

```sh
npm i -g donsetch
```

Then load the plugin from the clone, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["../opencode-plugins/plugins/oc-donsetch"]
```

It resolves the binary as `DONSETCH_BINARY` if set, otherwise `donsetch` on `PATH`, which is where
`npm i -g` puts it.

## What it does

`donsetch update` has no daemon and no config knob, so something has to run it. Not the service start: that
happens once a month on a machine that stays up. Not every prompt: that would be a network check per
message. Once a day, on the first prompt after the local date changes — the check happens while the tool is
about to be used, and never on an idle clock.

The stamp is `~/.cache/oc-donsetch/last-check` (or `$XDG_CACHE_HOME/oc-donsetch/last-check`), holding the
date it last ran. A failed check writes the stamp anyway: it only means the binary stays a day behind, and
retrying it on every prompt would be the thing this plugin exists to avoid.

The one failure that is not transient is the config file: `donsetch update` reads it, so an invalid key
kills every update while `--version` still answers 0 over the same file. The probe therefore reads that
command's stderr and logs the config error, instead of calling a dead tool healthy.

## The MCP server is not here

`donsetch` as an MCP server is a **config entry**, off by default: a server that is always connected costs
prompt tokens in every session, and the CLI is the path the agent uses. The plugin carries the updater and
nothing else.

Requires OpenCode v2 and the binary above. TypeScript, no build step, no runtime dependencies.
