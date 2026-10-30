# The public repository

**`github.com/rizal72/opencode-plugins`** — the plugins, their sources and their records, public, to be read
and forked. It is also the place they are written: the engineering log lives in a private sibling project,
and this repository is the code.

## What is here

`plugins/` (one package each), `types/`, the root `package.json` / `tsconfig.json` that make `npm run check`
work, `.github/` (the publish workflow and the issue form), `README.md`, `LICENSE`, `screenshots/`, and
`docs/` — one record per plugin plus the notes that are meaningless without them.

The posts, the video and the raw screenshots stay in the private project: they are not part of what a
stranger needs, and they are what makes a second repository worth its cost.

## A push is a release

`publish.yml` runs on every push to `main` and publishes every package whose version the registry does not
have yet, with provenance, through npm's trusted publisher. No token and no secret: the workflow is accepted
through OIDC, configured per package on npmjs.com.

**The repository holds sources, the registry receives a package.** `tui.tsx` and `gui.tsx` are what we write;
the workflow compiles them, points `./tui` at `tui.js` and rewrites the whitelist so no `.tsx` ships. That is
not tidiness: OpenCode compiles a `.tsx` from `node_modules` with the wrong JSX runtime and the plugin stops
existing — a user hit exactly that on 2026-10-25, and the whole compile step in CI exists to make it
impossible.

The gate that a push cannot give is local, because it must run *before* the commit reaches GitHub:
`scripts/preflight.sh` refuses a package whose content moved while its version did not. Skipping it leaves
npm on the old tarball while the repository shows the new sources, silently.

## Reports

Issues are **on**, with one form and no blank ones: `.github/ISSUE_TEMPLATE/bug.yml` asks for the opencode
version, the plugin and its version, how it was installed, the platform, and the error line. The "how it was
installed" question is the one that would have diagnosed the TUI load bug in one read instead of three days.

Pull requests stay **off** for now, and the reason changed with the repository: the tree is the source again,
so a patch *could* be merged — but `main` publishes on push, so merging a pull request would publish it. That
is a decision about the release path, not about kindness, and until publishing is attached to a tag instead
of a branch, a patch arriving in an issue is applied by hand.

Owning the repository does not subscribe you: `viewerSubscription` read `UNSUBSCRIBED` on 2026-10-26, so a
new issue would have arrived nowhere. Watch → **All activity** on the repository is the switch; reading or
writing that state through the API needs the `notifications` token scope, which the CLI token does not carry.
"All activity" includes pushes, and a push happens only on a release.

`repository.url` in the published `package.json` points here because the trusted publisher requires it, so the
npm page is a link to the repository. `homepage` stays out: one link, not two.

## Automating the reports

Nothing is automated yet, and that is deliberate: the first issues are worth reading by hand, because a
week of them says what the form should ask and what a workflow should check. The machinery is one command
away when that changes.

`opencode run` is the whole of it. The download page links it as *Git integration*, but the target is the
**CI** section of `/cli/commands`, and it describes an agent inside a pipeline, not a bridge between
OpenCode and git: `--standalone` for a private server, the provider key from the workflow secrets,
`--format json` for NDJSON a script can read, `--agent` to choose the behaviour, `--file` to attach the
text of the report.

Three levels, in the order of value over risk.

1. **A smoke test per release.** After the publish, a job repeats *Testing a published package*
   (`docs/publishing.md`): one `opencode plugin add` per published package, `find -name '*.tsx'` empty, one
   session answered, the TUI drawn — and comments the result on the release. Read-only, no issue text enters
   it, and it catches the load failure a user hit on 2026-10-25 before anyone has to report it.
2. **A triage on opening.** Read the body, name the plugin and the surface, apply the labels, ask what the
   form lets people skip. Needs `issues: write` and nothing more.
3. **A reproduction on a label.** Clone, install the reported version, open a PR. The most powerful and the
   last to build: a patch arriving from a stranger is worth reading by hand for a while yet.

Two rules hold at every level. The body of an issue is **untrusted input**, so `--auto` never runs beside a
token that can write: the agent produces text, and a later step applies it. And every issue costs tokens, so
a cheap model, a filter on the form, and `concurrency` on the workflow.

The key has to be a zero-retention provider. A report can carry logs and paths of someone's machine.

The model is a flag on the call, not a setting: `--model <provider/model>`. The `opencode/*-free` models
need **no credential at all** — measured 2026-10-28 with `env -i` and no key: `beam-free` answered. They
also rotate: `nemotron-3-ultra-free` was listed and gone within the hour. So the workflow names an ordered
preference and takes the first one `opencode models` still lists, rather than a fixed name that will vanish
or "the first free one", which is alphabetical and would pick the weakest.

The order is by **role**, not by name: first the one that triages best on this machine, then the one that
writes best, then the rest, with a small model as the floor. Written down on 2026-10-28, when the list held
eight: `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, then `beam-free` and
`flint-40b-free`. A model that leaves costs the **quality** of a triage and never the triage: the loop takes
the next one that exists.

Knowing when the head of that list is gone needs a check, not memory. A weekly `schedule` job can run
`opencode models` on the runner and open one issue, commenting inside it when it already exists, so it
cannot spam. The trap to remember: GitHub disables `schedule` workflows on a public repository after 60 days
without activity, and this repository is active in bursts — so the same file carries `workflow_dispatch`, and
the alternative is a silent cron that stopped working months ago.

Changing the model or its order is one line in `.github/workflows/`, a commit and a push. No version bump is
involved: the gate reads `plugins/`, and a workflow changes nothing anyone installs.

## What the history holds

Before 2026-10-28 this repository was generated: a script assembled it from one commit of a private project
and pushed it, so its commits say "Sync the plugins from commit …" and hold no history of their own. The
switch is recorded in `AGENTS.md` of the private project, and the state it left is the tag
`v0.2.0-desktop`.
