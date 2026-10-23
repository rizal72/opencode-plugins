# @rizal72/oc-git

The repository's state in the sidebar: the branch, then what has something to commit — added,
modified, untracked — then ahead/behind, which appears only when an upstream exists.

Each count is grey at zero and warning-yellow when it is not, so a clean repository reads `+0 ±0 ?0`
and does not catch the eye. While the repository is dirty, the three counts also appear in the prompt
footer, where a narrow window has no sidebar left.

The block is hidden outside a repository or on a machine without git.

## Install

```sh
opencode plugin add @rizal72/oc-git
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-git"]
```

## Use

Nothing to configure: the block reads `git status --porcelain=v2 --branch` every three seconds and
skips a read while the previous one is still running. It is read-only and needs no git server or hook.

Requires OpenCode v2. TypeScript, no build step, no runtime dependencies.
