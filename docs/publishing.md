# Publishing a plugin

**Status: in use.** Five packages, all published by the workflow: `oc-models-pro` `0.3.0`,
`oc-coffee`, `oc-git` and `oc-ponytail-widget` at `0.2.0`, `oc-session-search` at `0.2.2` (2026-10-28).
Under the `@rizal72/` scope, straight from this repository.

The install channel is npm alone: `opencode plugin add` reads a registry name, and that is the whole
story. The sources live here, in the public repository, which is also where they are written:
`docs/github.md`.

## The tarball gate, before the first publish

A plugin ships `.ts` **unbuilt**, and imports `@opencode/plugin/tui` and `solid-js` from the host. Both work
inside this checkout; neither is proven from an installed package. So the package is tested **as a
package** first:

```sh
cd plugins/<name>
npm pack                                  # <name>-0.1.0.tgz, built from `files` only
mkdir -p /tmp/pkg && tar -xzf <name>-0.1.0.tgz -C /tmp/pkg
```

Testing the package before publishing is possible, and it is what makes `0.1.0` safe:

1. unpack the tarball **inside a `node_modules` folder** — `/tmp/pkg/node_modules/<name>/`. The path is
   the test: a plugin loaded from an ordinary directory is compiled by OpenCode, one loaded from
   `node_modules` is not (see below), so a directory anywhere else proves nothing;
2. write `"plugins": ["/tmp/pkg/node_modules/<name>"]` in a throwaway `opencode.jsonc`;
3. open OpenCode in that directory with `opencode <dir>` — `--standalone` is rejected by `run`, so there is
   no private-server shortcut;
4. the plugin appears in `/plugins`, and it draws what it draws.

One thing to know while developing it: its entry is already in your global config, and a project `plugins`
list is **added** to the global one, not swapped for it. The same plugin then loads twice and the second
copy fails on the duplicate id — a failure of the test, not of the package, because a user has no second
copy. Comment that single line out for the test, put it back afterwards; `/plugins` lists both copies and
says which one failed.

If the only copy still does not load, it is one of four things: the tarball is missing a file (`files`), the
package imports `solid-js` in its server half, an import has to be declared as a dependency, or the source
has to be compiled. **Nothing is published until the unpacked tarball works**: `0.1.0` is the first
irreversible step.

## A TUI half ships compiled — the rule, not a workaround

**OpenCode compiles `.tsx` with Solid only outside `node_modules`.** Its loader's filter is
`/^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?$/`, so a `.tsx` that arrives from npm keeps Bun's default
JSX runtime, which is React's, and fails at load with `Cannot find package 'react'`. The server half is
unaffected: it has no JSX.

That makes the two copies deliberately different, for **every** TUI plugin, now and later:

| | the source, here | the published package |
|---|---|---|
| `exports["./tui"]` | `./tui.tsx` | `./tui.js` |
| `files` | `*.ts`, `*.tsx`, `README.md` | `*.ts`, `tui.js`, `README.md` |
| what runs locally | the source, recompiled by OpenCode on every edit | — |
| what npm installs | — | compiled JS, no JSX left |

- **The repository is never converted.** Keeping `./tui.tsx` is what preserves the live reload: edit the
  source, the panel changes, no build step.
- **The package is generated in the runner**, by `.github/workflows/publish.yml`: it runs
  `scripts/build-tui.mjs` (the host's own recipe — `babel-preset-solid` with `moduleName:
  "@opentui/solid"`) and rewrites that one `package.json` for every `@rizal72/*` package with a `tui.tsx`,
  then publishes. **Never into the repository**: a `tui.js` beside a `tui.tsx` shadows the source, because
  the loader resolves a directory by file name, and `npm run check` fails on one.
- **The compiled file imports only what the host provides** — `@opentui/solid`, `solid-js`,
  `@opencode/plugin/tui` — because anything else from `node_modules` is refused with *"is not provided by
  OpenCode"*.
- **No `peerDependencies` for those modules.** The V2 page recommends declaring `@opentui/core`,
  `@opentui/solid` and `solid-js` as peers; they are not needed, because the host resolves its own copies
  through a module registry, and a package that installs real ones risks loading a second Solid instance.
  Measured 2026-10-25 in a clean sandbox: a probe declaring them and shipping `.tsx` failed on `react`; the
  same probe with no installed peers and a compiled `tui.js` loaded and drew its slot.
- **The check that would have caught the bug**: pack the generated shape, unzip it under a `node_modules`
  path, and load it (step 1 above). Loading from anywhere else hides this class of failure entirely.

Measured 2026-10-25: `@rizal72/oc-coffee@0.1.0` from npm failed with `Cannot find package 'react'` on
OpenCode 2.1.4; the compiled `tui.js` built by this recipe resolves its imports to host-provided modules.

**A GUI half ships compiled too**, and for a stronger reason: a plugin window has no bundler and no
TypeScript, so `./gui-experimental` may only point at a prebuilt CommonJS file. `scripts/build-gui.mjs`
writes `plugins/<name>/dist/gui-experimental.cjs` for every package with a `vite.config.ts`; the directory
is git-ignored here, like `tui.js`. The published manifest therefore keeps `dist` in the rewritten `files` — dropping
it publishes an export pointing at nothing — and it is copied into the staged tree, because a generated
file in the published package is the point. A change to that bundle alone counts as content: the
version gate watches `dist/` and `package.json`, or npm would keep serving the old half.

Reported upstream on 2026-10-25, as a comment on the issue that already tracks it — *tui: support reactive
external TSX plugins in packaged CLI*, #39986 — with the published package as the case and the compiled
entry as the workaround.

## A push is the release

`main` holds what a developer writes; the workflow turns it into a package on the way out. Two consequences
worth naming, because both are what the earlier generated copy used to guarantee:

- **Nothing generated can be committed by accident.** `tui.js` and `dist/` are git-ignored and
  `check-source` refuses a `tui.js` beside its `tui.tsx`, so the repository cannot hold a half nobody can
  edit.
- **The gate runs before the commit, not after.** `scripts/preflight.sh` refuses a package whose content
  moved while its version did not. The workflow cannot do that job: by the time it sees the push, npm may
  already be behind, and the mistake reads as a bug that was fixed.

The condition for going back to shipping `.tsx` is not that issue closing: it is the `include` option in
`anomalyco/opentui#1741`, which compiles the folders whose path contains `node_modules`. Until it lands,
an installed `.tsx` fails twice — `Cannot find package 'react'`, and, with JSX supplied, Bun evaluates
`{n()}` once so the plugin draws its first frame and never updates.

## package.json

```jsonc
{
  "name": "@rizal72/<name>",
  "version": "0.1.0",
  "type": "module",
  "description": "One line: what it draws, for whom.",
  "license": "MIT",
  "files": ["*.ts", "*.tsx", "README.md"],
  "keywords": ["opencode", "opencode-plugin"],
  "publishConfig": { "access": "public" },
  "exports": { ".": "./index.ts", "./tui": "./tui.tsx" }
}
```

- **`publishConfig.access` is not optional.** A scoped package publishes as *restricted* by default and the
  command fails with a 403 without it.
- **`files` is a whitelist.** Without it the tarball carries `types/shims.d.ts`, the root `tsconfig.json` and
  anything else lying in the directory.
- **`exports` is the host's contract**, not npm's: the entry names (`index`, `tui`, `rpc`) are what the
  plugin loader resolves, and a package that renames them does not load.
- **`repository` stays out**, public repository or not: the package page needs no second link, and the one
  that points people at the sources is the post. `homepage` likewise.
- **A `README.md` in the package directory**: it is the npm page, and for a plugin it is the only
  installation note a user reads.

## Publish

```sh
npm login                  # once per machine
npm whoami                 # the account must own the @rizal72 scope
npm publish --dry-run      # the file list and the tarball size, before anything is irreversible
npm publish
```

Read the `--dry-run` list, not the directory: that list is the package. For a TUI plugin it is not the
published package — the workflow rewrites `exports` and `files` and ships `tui.js` instead of `tui.tsx`, so
the list above shows the source shape. The published shape is the one described under "A TUI half ships
compiled". A dry run that shows a file you did
not expect is the last moment to fix it for free.

**`npm publish` asks for the second factor** — the account is on `auth-and-writes`, so a publish is
always the owner's own act, and the tokens that could stand in for it are being retired.

**Before the bump, one reading**: the app release that prompted it may have changed the GUI SDK, so the
workarounds we carry need a look — `docs/gui-plugins.md`, *Provisional by design*. A workaround whose
reason is gone is a deletion, and a shape that moved is a shim to rewrite before a version goes out, not
after.

Staged publishing (`npm stage publish`, then `npm stage approve <id>` with 2FA) is the alternative when
the first half runs somewhere nobody can answer a prompt: `stage publish` needs no second factor, the
approval does. Typed on this machine it adds a step and saves none — it is for automation, not for us.

## What publishing measured

`0.1.0`, 2026-10-22, npm 11.20.0:

- **A new package waits for the automated review.** Staging returned an id at once; `npm stage approve`
  answered `409 … automated review hasn't finished` a minute later, and the same command worked after a
  few minutes. `npm stage list` shows `status: validating` while it runs.
- **The registry lags the approval by seconds.** `npm view` answered 404 for a moment after "approved
  and published successfully"; both packages resolved about 20 seconds later.
- **`npm whoami` succeeds and `npm publish` still asks for 2FA**: the login session can stage but not
  write, which is `auth-and-writes` doing its job.
- **A logged-out session reads as a `404`, never a `401`.** When `npm whoami` answers `401 Unauthorized`,
  `npm publish` fails with `404 Not Found - PUT …/@scope/name` and "you do not have permission", which
  points at the scope instead of the login. The fix is `npm login`, then publish again.
- **`oc-git` and `oc-session-search`, 2026-10-23**: same review wait, same lag; the first attempt on both
  was the logged-out `404` above.

## An update, after 0.1.0

**A commit is not a release.** Nothing publishes itself from this repository: no CI, no git hook, no
`prepublishOnly`. A version number in `package.json` never moves outside a release the owner asked for.
What follows is in "Publishing from GitHub" below: the bump, then the push.

He never has to know a version — he names a level, the script prints the move and waits.

| level | when | `0.1.1` becomes |
|---|---|---|
| `patch` | a fix, behaviour unchanged | `0.1.2` |
| `minor` | a new option or panel, or anything that breaks a key or the panel | `0.2.0` |
| `major` | the interface is declared stable — not "a big change" | `1.0.0` |

```sh
scripts/release.sh oc-models-pro patch
```

It refuses a dirty tree, refuses a package that is not publish-ready (unscoped name, no `files`), runs
`npm run check`, prints `0.1.1 -> 0.1.2` and asks; on `y` it bumps with `--no-git-tag-version` — npm's
own tag would be `v0.1.2` for every package at once — then prints the `npm pack --dry-run` list and stops.
It never commits, tags or publishes: those three lines are printed, and the last one is the owner's.

The release commit carries `git tag <name>@<version>`: nothing pushes it, and it is the only answer to
"which commit was 0.1.2" a year later. Record the version and the date in the plugin's own doc.

**On this machine the two paths stay local.** `opencode plugin add` is the user's command: run here it
would install the package and load a second copy of the same id, so the unpacked tarball is tested by
pointing the two global entries at it and back again — never by installing it.

The tarball gate above runs again only when packaging changes — `files`, `exports`, a dependency, an
import. For a code change the live copy under a path *is* the code being shipped, so the gate would test
nothing new.

## Publishing from GitHub — how it works now

**In place since 2026-10-24.** The manual `npm publish` is still possible (with 2FA) but it is no longer the
path: a release is the version bump plus a push, and the workflow publishes what the registry does
not have yet. The push happens from `main` only — the work branch and its rule are in `docs/github.md`,
*Branches*.

What is where:

1. `repository.url` in the five published `package.json`, exactly `rizal72/opencode-plugins` — npm refuses
   to publish from a workflow when the two disagree.
2. `.github/workflows/publish.yml`: on a push to `main` and on `workflow_dispatch`, `id-token: write`,
   `contents: read`, Node 24, then `npm ci`, `check:ci`, the two builds and the manifest rewrite before the
   publish loop.
3. A trusted publisher per package on npmjs.com (user `rizal72`, repository `opencode-plugins`, workflow
   `publish.yml`, **`npm publish` allowed** — `npm stage publish` is always allowed and is not a switch).
   Package settings then set to *require 2FA and disallow bypass tokens*, which leaves two doors: the
   owner with an OTP, and this workflow through OIDC.
4. A guard in the workflow: a package is published only when its version is **forward** of the registry's,
   so a sync with unchanged versions is a green no-op and an old number can never move `latest` back.

**The rule above changes with this.** "A commit is not a release" becomes: *a sync that carries a new
version is a release*. The control sits one step earlier — `scripts/release.sh` prints the tarball before
the push — and nothing publishes on its own from this repository, which has no remote.

Measured 2026-10-24, the first automatic release: `oc-models-pro@0.1.2`, 21 s of runner, provenance signed
and published to the transparency log, and the registry entry carrying `_npmUser: GitHub Actions` with the
trusted publisher's `oidcConfigId`. The run before it, with nothing to publish, was a green no-op — which
is what every ordinary sync looks like.

The one failure mode to know: a broken publish (wrong `repository`, a renamed workflow) fails **in the
Actions tab** and nowhere else. Nothing alerts.

## Who is using them

Download counts come from the registry's own API; a package younger than a day has no row yet:

```sh
for p in oc-models-pro oc-git oc-coffee oc-ponytail-widget oc-session-search; do
  printf "%-20s " "$p"
  curl -s "https://api.npmjs.org/downloads/point/last-month/@rizal72/$p" | jq -r '.downloads // "no data"'
done
```

The repository is the faster signal, and it has no lag: `gh api repos/rizal72/opencode-plugins/traffic/views`.

Both are worth reading only after the packages and the repository have been out long enough to be found:
a number taken the day they appear measures the announcement, not the use.

## What the user runs

```sh
opencode plugin add @rizal72/<name>     # installs it and writes the global config
opencode plugin list                    # it is there, and where it came from
opencode plugin check                   # is there a newer version
opencode plugin update                  # move to it
opencode plugin remove @rizal72/<name>  # take it away
```

`plugins` in `~/.config/opencode/opencode.jsonc` accepts a registry name, `name@version`, a local
directory, a `file://` URL or a Git specifier; `plugin add` writes the plain name.

## Testing a published package

Install what the registry actually holds, in a sandbox whose `HOME` is not yours: the shared service is
bound to the real one, and a plugin that loads there hides the failure it would meet on a clean machine.

```sh
SB=$(mktemp -d)
export HOME=$SB/home XDG_DATA_HOME=$SB/data XDG_CONFIG_HOME=$SB/config
mkdir -p $HOME $XDG_DATA_HOME $XDG_CONFIG_HOME

for p in oc-coffee oc-git oc-models-pro oc-ponytail-widget oc-session-search; do
  opencode plugin add @rizal72/$p
done

opencode run --standalone --model <a free one> "Reply with exactly: ok"   # the server halves load
opencode --standalone                                                     # the TUI halves draw
```

`--standalone` on every command: without it the CLI reaches for the shared service and exits on its port.
A tool-only plugin is proved by calling it — `session_search` answering is the whole test. Do the tree
first, before the app: `find $SB -name '*.tsx'` must print nothing, because a published `.tsx` is the
failure below.

**The failure this catches**, measured on a user's machine on 2026-10-25: `Status: failed Runtime: tui`,
`Cannot find package 'react' imported from …/@rizal72/oc-coffee/tui.tsx`. Nothing was wrong with the
plugin: the client compiled a `.tsx` from `node_modules` with the wrong JSX runtime and the plugin stopped
existing. No `.tsx` in the tarball, no such error — the compiled half is the rule, not a workaround.

The GUI halves cannot be tested this way: they need the app window. `dist/gui-experimental.cjs` is checked
for parsing and for being exported as `./gui-experimental`, and the first user with the app is its real
test.

## Versions, and the way back

- Semver, `0.x` while the interface can still move; breaking a key or the panel takes a minor bump.
- **A published version is immutable.** A mistake becomes `0.1.1`, never a republish of the same number.
- `npm deprecate @rizal72/<name>@0.1.0 "reason"` is the normal exit: it marks the version and leaves the
  history readable.
- `npm unpublish` works for 72 hours and npm may refuse to reuse that version afterwards. Emergency only.

## What the first test measured

`oc-models-pro`, 2026-10-19, on OpenCode 2.0.32:

- **`npm pack` refuses a package with no `version`**: `Invalid package, must have name and version`.
- **The unpacked package loads.** The log carries `msg="loading plugin" entrypoint=file:///…/unpacked/package/index.ts`
  and no error, so `exports` to `.ts`/`.tsx`, the transpile and `@opencode/plugin` all resolve from a bare
  directory with no `node_modules` at any level.
- **`solid-js` is not resolvable in the server process.** A probe importing it in `index.ts` dies with
  `Cannot find package 'solid-js'`. The TUI runtime provides it: `tui.tsx` imports it and works, `index.ts`
  must not.
- **The duplicate id**, as above: two `oc-models-pro` entries, the second failed.
- **The tarball is small and clean**: 6 files, 18.4 kB — `index.ts`, `tui.tsx`, `bench.ts`, `multipliers.ts`,
  `fit.ts`, `package.json`.
