# Publishing a plugin

**Status: in use.** Every `@rizal72/` package is published by the workflow from this repository; `ls plugins`
says which ones exist and `npm view @rizal72/<name> version` which ones the registry has.

The install channel is npm alone: `opencode plugin add` reads a registry name, and that is the whole
story. The sources live here, in the public repository, which is also where they are written:
`docs/github.md`.

## A new package: the name has to exist before the workflow can publish it

The trusted publisher lives on the package's **settings page on npmjs.com**, and a package that does not
exist has no settings page — so the first publish of a new name is manual, by the owner, with an OTP. The
workflow takes over from the version after.

Measured 2026-10-30 on `@rizal72/oc-plugin-updates`:

```sh
cd plugins/<name>
npm version 0.0.1 --no-git-tag-version   # a placeholder, only to claim the name
npm publish --access public              # OTP; no --tag, 0.0.1 is not a prerelease
git checkout -- package.json             # back to the real version, tree clean for the push
```

Then on the package's page: **Trusted publishing** → GitHub Actions, user `rizal72`, repository
`opencode-plugins`, workflow `publish.yml`, with **`npm publish`** allowed; and **Publishing access** →
*require 2FA and disallow tokens*. After that a push publishes the real version, with provenance.

Two things that cost a round trip each:

- **`0.0.0-stage` no longer works.** The packages published before 2026-10-30 carry it, and the same
  version is now refused: `403 You cannot publish using the version: 0.0.0-stage`. `0.0.1` is the version
  that goes.
- **A `404` on the `PUT` is not always a name problem.** With an expired session the registry answers exactly
  that; `npm whoami` says `401` and the fix is `npm login`. Measured in the same attempt.

The registry answers `404` for a few minutes after the publish — *"being processed"* — and `npm view
<name> version` is the signal that the page is ready to configure.

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
- **That import list is why an OpenTUI major costs us nothing.** Since `@opencode/plugin` 2.2.3 the host
  requires `@opentui` 0.8, which turned ScrollBox's parts into facades; our halves never import it, and the
  `tui.js` we ship calls only reconciler primitives that 0.8.0 still exports (`createComponent`,
  `createElement`, `createTextNode`, `effect`, `insert`, `insertNode`, `memo`, `setProp`, `use` —
  `@opentui/solid@0.8.0`, `src/reconciler.d.ts`, read 2026-10-30). No republish needed for that change alone.
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

## Two consequences of the push

`main` holds what a developer writes; the workflow turns it into a package on the way out.

- **Nothing generated can be committed by accident.** `tui.js` and `dist/` are git-ignored and
  `check-source` refuses a `tui.js` beside its `tui.tsx`, so the repository cannot hold a half nobody can
  edit.
- **The gate runs before the commit, not after.** `scripts/preflight.sh` refuses a package whose content
  moved while its version did not. The workflow cannot do that job: by the time it sees the push, npm may
  already be behind, and the mistake reads as a bug that was fixed. The same gate installs the lock with
  `npm ci --dry-run`: the workflow's first step is a real `npm ci`, which stops dead on a lock that does
  not satisfy it — what an install run with `--legacy-peer-deps` leaves behind, since that flag prunes the
  peers the lock still names (measured 2026-10-30: the run failed 16 s in, after the push).

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

## The manual path

`npm publish` still works, with the second factor: the account is on `auth-and-writes`, so a publish is
always the owner's own act, and the tokens that could stand in for it are being retired. It is not the
path — a push is. Keep `npm publish --dry-run` for reading the package: that list, not the directory, is
what ships — and for a TUI plugin it shows the *source* shape, since the workflow rewrites `exports` and
`files` on the way out.

**Before the bump, one reading**: the app release that prompted it may have changed the GUI SDK, so the
workarounds we carry need a look — `docs/gui-plugins.md`, *Provisional by design*. A workaround whose
reason is gone is a deletion, and a shape that moved is a shim to rewrite before a version goes out, not
after.

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

**A commit without a bump is not a release.** A version number in `package.json` never moves outside a
release the owner asked for, and the workflow publishes only a version the registry does not have yet.

He never has to know a version — he names a level, the script prints the move and waits.

| level | when | `0.1.1` becomes |
|---|---|---|
| `patch` | a fix, behaviour unchanged | `0.1.2` |
| `minor` | a new option or panel, or anything that breaks a key or the panel | `0.2.0` |
| `major` | the interface is declared stable — not "a big change" | `1.0.0` |

```sh
scripts/release.sh patch oc-models-pro          # the level, then one or more packages
```

`scripts/release.sh --help` carries the mechanics: the clean tree and `main` it insists on, what it runs
before asking, and that it stops before the registry — it never commits and never publishes. The two lines
it leaves are the commit and the push, both the owner's.

The release commit's own message and the plugin's doc answer "which commit was 0.1.2" a year later: record
the version and the date in the plugin's own doc.

**On this machine the two paths stay local.** `opencode plugin add` is the user's command: run here it
would install the package and load a second copy of the same id, so the unpacked tarball is tested by
pointing the two global entries at it and back again — never by installing it.

The tarball gate above runs again only when packaging changes — `files`, `exports`, a dependency, an
import. For a code change the live copy under a path *is* the code being shipped, so the gate would test
nothing new.

## The workflow

In place since 2026-10-24. The push happens from `main` only — the work branch and its rule are in
`docs/github.md`, *Branches*. What is where, once per repository:

1. `repository.url` in every published `package.json`, exactly `rizal72/opencode-plugins` — npm refuses
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

Measured 2026-10-24, the first automatic release: `oc-models-pro@0.1.2`, 21 s of runner, provenance signed
and published to the transparency log, and the registry entry carrying `_npmUser: GitHub Actions` with the
trusted publisher's `oidcConfigId`. The run before it, with nothing to publish, was a green no-op — which
is what every ordinary sync looks like.

The one failure mode to know: a broken publish (wrong `repository`, a renamed workflow) fails **in the
Actions tab** and nowhere else. Nothing alerts.

**After the push, nothing polls.** The workflow is the record, and the registry lags by minutes anyway:
read `npm view --prefer-online @rizal72/<name> version` once, when the owner asks, or launch that single
command in the background and let it report once when the version appears. A loop of checks gains nothing
and holds the turn — the answer cannot arrive sooner for being watched. The flag matters: without it `npm
view` answers from a cached packument and reports the version *before* the publish (measured 2026-10-30,
`oc-git` reading 0.2.1 with 0.2.2 already on the registry and on `latest`).

## Who is using them

Download counts come from the registry's own API; a package younger than a day has no row yet:

```sh
for p in $(ls plugins); do
  printf "%-20s " "$p"
  curl -s "https://api.npmjs.org/downloads/point/last-month/@rizal72/$p" | jq -r '.downloads // "no data"'
done
```

The repository is the faster signal, and it has no lag: `gh api repos/rizal72/opencode-plugins/traffic/views`.

Both are worth reading only after the packages and the repository have been out long enough to be found:
a number taken the day they appear measures the announcement, not the use.

## Listed in a catalog

The plugins are listed in `hashgraph-online/awesome-ai-plugins`, section **OpenCode Plugins**, as one line
in alphabetical order and without a `platform:` tag — that tag belongs to standalone tools elsewhere in the
catalog, and the OpenCode section supplies the platform itself.

Getting there is a pull request adding that single line, and it is gated by a **plugin scanner** run against
this repository. The scan is why this repo carries a `SECURITY.md`, Dependabot, GitHub Actions pinned to
immutable commits and no `execSync`: those were its five findings, and a repository built to pass it passes
it (67 → 100, measured 2026-10-30). The scanner's verdict and the catalog's own check are separate things,
so a red gate on a PR is worth reading before it is believed.

Ownership of the listing is claimed in **HOL Guard**, the catalog's owner dashboard, signing in with the GitHub
account that owns the repository. The claim is **per repository, not per package** — one verification covers
all of them, which is why the dashboard reads `1 verified` beside six packages. The dashboard is the owner's
alone: an agent reaches it only through the browser the owner is already signed in to, and reads — it has no
button to press there.

What it holds, read off the dashboard on 2026-10-30: growth is five steps, three free — a launch page in the
catalog's feed (its copy says it unlocks catalog placement), a **verified badge for the README** carrying the
live trust score, and a story on their blog — and two paid: a **labelled slot at the top** of the catalog,
whose copy states that votes, reviews and organic rank do not change, and a **blue checkmark** that opens on
its own gate (an audience, a signed release, or a place on an approved feed). The README badge and the blue
checkmark are different things: the first is free, the second is the membership.

Under `Tools`, the rest: install blocks per runtime, webhooks, a release checklist, and a read-only stats key
for the terminal. Its analytics carry two honest caveats worth keeping: counts include the owner's own
visits, and an install click is intent, not a confirmed install — and `no traffic data recorded` is written
to mean that, not zero views.

The fork used for the pull request is disposable: delete it after the merge, and the entry survives,
because the catalog copies the line into its own repository.

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
