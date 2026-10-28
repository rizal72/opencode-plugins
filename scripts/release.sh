#!/usr/bin/env bash
# Prepares a release of one plugin and stops before the registry.
#
# It never publishes, never commits and never tags: it checks, bumps the version, packs a dry run and
# prints the three lines left to run. A release is the owner's word, twice — once for the level here,
# once for `npm publish`. Why: docs/publishing.md.
set -euo pipefail

usage() { echo "usage: $(basename "$0") <plugin> <patch|minor|major>" >&2; exit 2; }

[ $# -eq 2 ] || usage
name="$1"
level="$2"
case "$level" in patch|minor|major) ;; *) usage ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/plugins/$name"
[ -f "$dir/package.json" ] || { echo "no package.json in plugins/$name" >&2; exit 2; }

dirty="$(git -C "$root" status --porcelain)"
[ -z "$dirty" ] || { printf 'working tree is not clean:\n%s\n' "$dirty" >&2; exit 1; }

# A release is cut from the branch that publishes: a bump made on the work branch would reach main by a
# merge and put that number in front of the registry without main ever having been the thing tested.
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "on branch '$branch': cut the release from main (docs/github.md, Branches)" >&2; exit 1; }

read_field() { node -p "const p=require('$dir/package.json'); String(p[$1] ?? '')"; }
pkg_name="$(read_field "'name'")"
current="$(read_field "'version'")"
files="$(read_field "'files'")"
access="$(read_field "'publishConfig'" 2>/dev/null || true)"

case "$pkg_name" in
	@*/?*) ;;
	*) echo "not publish-ready: name is '$pkg_name', not a scoped @rizal72/<name> (docs/publishing.md)" >&2; exit 1 ;;
esac
[ -n "$files" ] || { echo "not publish-ready: no 'files' whitelist (docs/publishing.md)" >&2; exit 1; }

next="$(node -e '
  const [maj, min, pat] = process.argv[1].split(".").map(Number)
  const level = process.argv[2]
  if (level === "major") console.log(`${maj + 1}.0.0`)
  else if (level === "minor") console.log(`${maj}.${min + 1}.0`)
  else console.log(`${maj}.${min}.${pat + 1}`)
' "$current" "$level")"

echo "$name: $current -> $next ($level)"
[ "$level" != major ] || echo "note: major declares the interface stable, it is not 'a big change'."

(cd "$root" && npm run check >/dev/null) || { echo "npm run check failed" >&2; exit 1; }

read -r -p "bump to $next? [y/N] " ok || true
[ "$ok" = y ] || { echo "stopped, nothing changed."; exit 1; }

(cd "$dir" && npm version "$level" --no-git-tag-version >/dev/null)
(cd "$dir" && npm pack --dry-run)

cat <<EOF

Nothing has been published. The three lines left, run from the repository root:

  git add plugins/$name/package.json && git commit -m "Release $name $next"
  git tag $name@$next
  scripts/mirror-public.sh --publish   # the push publishes on npm, with provenance

A direct \`npm publish\` still works, with the second factor — the mirror push is the path now.

Then: npm view $pkg_name version   and   opencode plugin update
EOF
