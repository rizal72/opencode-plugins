# oc-git — the record

The repository's state in the sidebar, vertical because the sidebar has room:

```
 <git glyph> Git status        bold, plain text colour
 <branch glyph> main           the theme's accent
 +0 ±2 ?1                      each figure grey at zero, warning yellow when it is not
 ↑0 ↓0                         only when the branch has an upstream
```

The one gap the owner named: from OpenCode he could see no repository state at all. These two values tell
him, at a glance, whether there is anything to commit and which branch he is on — which matters because
several of his projects work on `develop`, not `main`.

The block reaches the top of the sidebar with `prepend`, like the other two of ours; the mechanism and
the measurement are in `docs/sidebar.md`.

## Desktop half

The desktop has no sidebar to put the block in, so the pill carries what the block said —
`desktop +0 ±5 ?6` — and it stays visible when the repository is clean, because there the branch is the
news and nothing else would say it.

- label: branch, then added / changed / untracked, then the two arrows. `tone` is one rule for the
  capsule and every row: `warning` while there is something to do, `success` when the answer is zero — so
  the branch icon is green on a clean, synchronised repository and yellow when there is anything to
  commit **or when the branch is behind its upstream**. Behind is the figure that is never a resting
  state; `ahead` alone stays green, because waiting for a push is what a working branch does, and the
  number in the label is the news. Icons: `branch`, `plus`, `pencil-line`, `open-file` (not
  `file-document`, which the app's drawing set does not carry: it draws a `plus`, already the added row's
  mark).
- the arrows enter the label **only when they are not zero**: nothing committed is nothing to push, so a
  zero adds nothing the absence does not say — the pair appears when there is news and not before. It sits
  at the end of the capsule, where the host truncates, so the branch is capped by what follows it (20
  characters minus the pair) and the pair cannot be the part that goes.
- rows on a click: the branch name as the row's own text — the name is the news, and `detail` is muted;
  `↑ahead ↓behind` on its own row, only when an upstream exists, **always as the row's own text**. It was
  tried in `detail` to grey the pair at zero, and the host draws `detail` as a bordered chip at the far
  right of the row, not as muted text: the colour option a row seemed to offer is not there. Then the three
  groups by name.
- data: the same `git status --porcelain=v2 --branch` every 3 s, read **on the session's own server** — a
  GUI window has no Node built-ins — through `Git.status` in `rpc.ts`, asking that server's client at every
  call: a restarted server gets a new one under the same id. `git.ts` holds the parser and the read for
  both halves.

## Why ours

**There is no plugin registry for OpenCode.** Distribution is npm, GitHub and three community hubs
(`opencode.cafe`, `opencode.im`, `awesome-opencode`). Eight git widgets were surveyed on 2026-10-17 and
none covers branch + counts + ahead/behind together: the closest, `opencode-git-stats`, has no
ahead/behind and draws a plane-0 glyph; `opencode-git-plugin` has a file panel but neither branch nor
ahead/behind; `ocstatusline` has exactly the data but runs as a separate pane, not as a slot.

## Data

`git status --porcelain=v2 --branch`, one read-only call every 3 seconds, **skipped while the previous one
is still running** so a very large repository cannot stack reads:

- `# branch.head` → the branch
- `# branch.ab +N -M` → ahead/behind, printed only when an upstream is configured
- `1` / `2` / `u` entries → `+` when the index marks `A`, `±` for every other tracked change
- `?` entries → untracked

**Not `ctx.vcs`**, the plugin API's own VCS domain: it exposes the branch and the file list, not these
counts, and not ahead/behind. The parser was checked on a scratch repository (2026-10-17) with the three
cases present at once — `1 A.` → added, `1 .M` → modified, `?` → untracked — result `1 / 1 / 1`.

## The footer line

The same figures also sit in `prompt.footer.status`, before the budget and after the coffee and ponytail
badges: `<git glyph> +n ±n ?n` — no branch, no ahead/behind — and it appears **only when at least one figure
is non-zero**, so a clean repository shows nothing at all.

Two reasons. The footer already prints the branch, so repeating it there would be noise. And the case this
line exists for is the narrow screen: on a phone the sidebar is off (`session.sidebar: auto`) and the whole
block is invisible, so the line is the only git signal left — its absence meaning "nothing to commit" is the
message. The sidebar keeps its full block, ahead/behind included.

Order comes from plugin load order, so `oc-git` contributes before `oc-budget`, and that reads correctly: git
is unrelated to provider, context and spend, so it belongs on the far left of ours.

## Title, glyphs, colour

The title keeps the shape the other two sidebar blocks settled on: dim glyph, **bold** word, initial
capital only — `Git status`. The two glyphs are pi's own (`U+E702` git, `U+E725` branch), copied from the
widget this one is meant to resemble and verified by reading the codepoints back out of the source; they
are plane 0, which renders in the TUI exactly as it does in pi.

Three rules for colour, and no more:

- the **branch** always in the theme accent — `syntax.function`, then `syntax.variable`, then `text.base`;
- each **count** in the warning yellow, the same hue the Context block uses, **only when that figure is
  not zero** — grey when it is. A clean repository is therefore three grey zeros that do not catch the
  eye, and only the figure that moves turns yellow;
- **`↓n` on the ahead/behind line** follows the counts' rule — yellow when the branch is behind its
  upstream, grey otherwise. **`↑n` goes white**, not yellow: it is news worth seeing, and a presentation
  or two is not a warning. Two weights, one alarm.

Green and red were tried and dropped: in this UI they mean ok and alarm, and a count is neither. Hex only
as a last-resort fallback.

## Config

Path in `~/.config/opencode/opencode.jsonc`, listed **after `oc-context`** so the block follows it in the
sidebar. Nothing in `cli.json`: no built-in is switched off — `sidebar.content` accepts `append`, so the
block sits beside the existing ones.

## Ceilings

- A `git` process every 3 seconds while the TUI is open. Cheap on these repositories; the no-stacking
  guard is the only defence on a very large one.
- Counts only — no per-file list, no staged/unstaged split. Both left out on purpose: the diff is where
  that detail belongs.
- `↑0 ↓0` stays visible whenever an upstream exists: it is the "nothing to push, nothing to pull" signal,
  not noise.
- **behind is as fresh as the last `fetch`**, not as the remote is now: the poll is `git status`, which
  reads the local remote-tracking ref and never touches the network. Yellow means "behind what this
  repository knows", and a `fetch` is what makes it true again.

Published as `@rizal72/oc-git@0.1.0` on 2026-10-23, `0.1.1` on 2026-10-25 with the compiled TUI half;
procedure in `docs/publishing.md`.
