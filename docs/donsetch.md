# DonSeTch — the record

The escape hatch for pages that refuse an agent: 403s, Cloudflare walls, JS-only shells. Since browse
exists it is no longer the first move — the owner's cookies win a login, `webfetch` wins a public page —
and it is the route when those refuse, and for the agent's own research, which never runs as the owner.
Its **CLI** is the path for the agent; the MCP server is not registered, and the binary is kept current by
**`oc-donsetch`**, our plugin, which checks the binary's update once a day.

## How it got here

Three states, three days. **2026-10-17**: mounted as an MCP server of the global config, with a
`launchd` agent for the daily update. **2026-10-18**: that agent cost more than the tool deserved — a
plist, logs in `/tmp`, a `launchctl bootout` in the undo — so everything moved into a plugin that
registered the server at runtime and checked the update on the prompt hook. **2026-10-21**: the
always-connected server was weighed — about 931 tokens in every first prompt, and a cache miss every
time it was switched — so the registration moved to the config and then out of it. The CLI is the path;
the plugin keeps the binary current.

## What it is

One Rust binary plus `libonnxruntime` (OCR, semantic rerank), AGPL-3.0, **keyless**. `donsetch update`
replaces the binary inside the installed npm package, so the two versions part company: on 2026-11-12
`npm ls -g` printed `donsetch@4.10.1` and the binary answered `5.2.1`.

- tier 1 fetches with Chrome's own TLS (BoringSSL ClientHello), persistent cookies, session resumption;
- v5 answers a challenge in process, with a V8 engine for the page's own challenge programs: the fetch path
  carries no browser at all (v5.0.0 release notes, "no browser in the path"). The installed Chrome is
  launched only by `web_screenshot`;
- it does **not** install a browser, and it does **not** solve captchas that need a human, by design.

That is why it beats the alternatives: `r.jina.ai` answers 403 (it needs a key now), Firecrawl, Browserbase
and Jina MCP all want an account and are paid, Playwright / Puppeteer / Chrome DevTools MCP drive a browser
page by page and hand you automation, not markdown. No OpenCode plugin does this on V2: the only
self-installing one runs the V1 plugin API.

## A page behind a login is a wall

v5 removed `donsetch login` and the session vault it fed, and the headful browser path with them; the
release notes state that `web_fetch` no longer sends sessions stored by the old login, and a page behind a
login is a declared auth wall. Authenticated reading is `browse`'s job — the owner's own Chrome, his
logins, his extensions. donsetch is the route for a page that refuses an agent, never for a page that
wants the owner's identity.

## The binary is installed separately

**This is the part easy to forget.** `plugins/oc-donsetch/` does *not* install DonSeTch: it expects the
binary to exist and only updates it. Installing it is one command, once:

```sh
npm i -g donsetch
```

The plugin resolves it as `DONSETCH_BINARY`, else `donsetch` on PATH, and checks it answers
(`--version`): that is the binary it updates. The one on PATH is a shim that needs `node`; the CLI runs
either, the MCP entry named the real one. If the binary is missing the plugin says so in the log and
the tool is simply absent.

Installing it inside the plugin was considered and left out on purpose: that would mean downloading and
executing a binary from the plugin, which is more code to own and review than one npm command saves.

## On disk — the inventory

| path | size | what | removable? |
|---|---|---|---|
| `/opt/homebrew/lib/node_modules/donsetch/` | 53 MB | the npm package; the real binary is `binaries/donsetch` | only after `npm un -g donsetch` |
| `/opt/homebrew/bin/donsetch` | — | npm **shim** (JavaScript, needs `node`): what the plugin finds on PATH and what the CLI runs | with the package; the shim works, the plugin also accepts the real binary via `DONSETCH_BINARY` |
| `~/.config/opencode/opencode.jsonc` | — | two lines: the plugin in `plugins`, and the `mcp.servers.donsetch` entry **commented out** | both |
| `~/Library/Application Support/donsetch` | 4 KB | `donsetch.toml`, the only settings file the tool reads, plus cookies, cooldowns, search state | with the tool |
| `$XDG_CACHE_HOME/oc-donsetch/last-check`, else `~/.cache/oc-donsetch/last-check` | 10 B | the date of the last update check, so it happens once a day | harmless; recreates itself |
| `~/.pi/agent/npm/node_modules/donsetch` | 53 MB | Pi's own copy, which Pi's extension manager updates | Pi's business |

Nothing else: the `launchd` agent that used to run the updates, its plist and its `/tmp` logs are gone.

## The toml, and the key that kills every command

`~/Library/Application Support/donsetch/donsetch.toml` is the owner's file, and one unknown key in it is
fatal rather than ignored: every command but `--version` exits 1 with `invalid config file … unknown
field 'x', expected one of …`, so a fetch, a crawl, `doctor` and `update` all do nothing at all.

That is what a v4 setting costs after a v5 update. `[browser] backend = "headless"` named the render path
when the file was written on 2026-09-29; the v5.0.0 release notes remove the headful path, and the key went
with it. The record here had never mentioned the file, so nothing said a schema had moved under it.

The check that follows, after any update that crosses a major version: run `donsetch fetch
https://example.com` once, with the file in place. That command separates the two states — it answers
`ok` on a valid file and prints the config error on a broken one — where `--version` prints the version
and exits 0 over both.

## Config

In `~/.config/opencode/opencode.jsonc` the plugin is in `plugins`; the server is **not registered** — its
entry sits commented out, with the CLI as the path:

```jsonc
// "donsetch": {
//   "type": "local",
//   "command": ["/opt/homebrew/lib/node_modules/donsetch/binaries/donsetch", "mcp", "--supervised"],
//   "disabled": true
// },
```

**The agent's path for a hostile fetch is the CLI**: `donsetch fetch <url>` and its three siblings do the
same work with the same engine, with no server and no configuration to change. The server is not
registered because a server that is always connected costs prompt tokens in every session, and
switching one on changes the request and invalidates the session's prompt cache, so the whole context
is read again — a cost one fetch does not earn. Uncommenting the entry brings the MCP back: the config
file is watched, so the running session picks the change up without a reload and without a restart, and
its tools arrive on the next step. The owner's `/mcps` panel does the same.

Measured 2026-10-21: the first prompt of a clean session carries **4,084 characters less** with the
server off than with it on, about 931 tokens at the gateway's ratio. The four tool signatures and the
server's own instructions go away; the Code Mode catalogue becomes complete, so its `search` block goes
and the `opencode` namespace is printed in full — the two nearly cancel. The process starts only when
the server is on.

What the plugin does at load, in order: resolve the binary (skip and warn when absent), then arm the
update check on the prompt hook. Both were observed through a wrapper binary: `called: --version`,
`called: update`.

## Updates

`donsetch update` has no daemon and no config knob, so the plugin runs it — on the **prompt hook**, once a
day: the prompt that arrives after the date has changed. The stamp in that cache file holds the date of
the last check, in `YYYY-MM-DD`.

Not on the service start (once a month here), not per session (sessions are continued for days here), and
not on a clock — which is what the `launchd` agent it replaced did, whether or not OpenCode was open. The
check happens while the tool is about to be used, and at most once a day.

Measured 2026-10-18 through a wrapper binary: a stamp dated today produced no check; a stamp dated
yesterday produced one and rewrote the stamp to today; a further prompt the same day produced none.

The accepted trade-off: a machine where OpenCode is never opened never checks, and a machine left open
without prompts checks only once the next prompt arrives. Pi's copy is kept current by Pi's own extension
manager, independently.

**A broken config makes the daily check a no-op.** `donsetch update` loads the same toml, so an invalid
key kills the update as surely as it kills a fetch, while the probe the plugin ran to decide the binary
was alive (`--version`) exits 0 over the same file. The stamp moved to today, the binary stayed a major
version behind, and no line anywhere said so — found on 2026-11-12, 5.1.2 stuck while 5.2.1 had been out
since 9 November. The probe reads `--version`'s stderr now and logs the config error instead of discarding
it.

The binary keeps `rollback`, `status` and `doctor` for the manual cases; `donsetch update` remains the
manual command.

## Verified, and its ceiling

- `https://www.reddit.com/r/rust/` — the native fetch returns an 8 KB shell; `curl` the same, with either
  user agent. Through the tool: the real listing, `ok:true`, and an honest `partial:true` with
  `additional posts require client-side loading`.
- `https://www.g2.com/` — refused, and it says why: `interactive captcha requires a human browser session`.
  No automated path, by design.
- A registered server whose binary does not exist: the session runs normally and the log carries
  `message="mcp connect failed"` with the spawn error. No silent failure, no broken session.
- The config entry behaves like the runtime registration it replaced: switched on from the config, the
  tools appeared in the running session on the next step and `web_fetch` on `reddit.com/r/rust/` gave
  the real listing (`ok:true`, `partial:true`); switched off, the tools left the catalogue and the
  process was gone. The config file is watched: no reload, no restart (measured 2026-10-21).

So: walls of the fingerprint/cookie kind fall; walls that demand a human do not. The zero-install fallback
for those stays `https://web.archive.org/web/2026/<url>` — a snapshot, not the live page.

## Undo

```sh
npm uninstall -g donsetch
rm -rf ~/Library/Application\ Support/donsetch
```

then delete the plugin line from `~/.config/opencode/opencode.jsonc` and the commented `mcp.servers`
entry with it. No `launchd` agent left to remember: it was removed on 2026-10-18.

**If upstream ever ships an OpenCode plugin**, ours can go: remove the line, install theirs, and keep the
binary — it will want it too.
