# @rizal72/oc-git

The repository's state, in the terminal and in the desktop app: the branch, then what has something to
commit — added, modified, untracked — then ahead/behind, which appears only when an upstream exists.

Each count is grey at zero and warning-yellow when it is not, so a clean repository reads quietly. The
plugin draws nothing outside a repository or on a machine without git.

## Install

```sh
opencode plugin add @rizal72/oc-git
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-git"]
```

## TUI

A block in the sidebar. While the repository is dirty the three counts also appear in the prompt footer,
where a narrow window has no sidebar left.

## GUI

A pill above the composer, with the whole state in its label: `desktop +0 ±1 ?1`. Its rows spell out what
the figures are — added, changed, untracked — plus the upstream when there is one.

## How it works

One read of `git status --porcelain=v2 --branch` every three seconds, from the server half, shared by both
surfaces; a tick is skipped while the previous read is still running. Read-only: no hook, no git server,
nothing written.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
