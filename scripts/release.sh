#!/usr/bin/env bash
# Prepares a release of one or more plugins and stops before the registry.
#
# It never publishes, never commits and never tags: it checks, bumps the versions, packs a dry run for each
# and prints the lines left to run. A release is the owner's word, twice — once for the level here, once for
# `npm publish`. Why: docs/publishing.md.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: release.sh <patch|minor|major> <plugin...>

  Bumps one or more packages in plugins/ and stops before the registry.
  The working tree must be clean and the branch must be main: the tree is
  checked once, before the first bump, so a multi-package release is one call.

examples:
  scripts/release.sh patch oc-git
  scripts/release.sh patch oc-git oc-coffee oc-models-pro
  scripts/release.sh --help
EOF
}

case "${1:-}" in
	-h | --help)
		usage
		exit 0
		;;
esac

[ $# -ge 2 ] || {
	usage >&2
	exit 2
}
level="$1"
shift
case "$level" in patch | minor | major) ;; *)
	usage >&2
	exit 2
	;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"

dirty="$(git -C "$root" status --porcelain)"
[ -z "$dirty" ] || {
	printf 'working tree is not clean:\n%s\n' "$dirty" >&2
	exit 1
}

# A release is cut from the branch that publishes: a bump made on the work branch would reach main by a
# merge and put that number in front of the registry without main ever having been the thing tested.
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || {
	echo "on branch '$branch': cut the release from main (docs/github.md, Branches)" >&2
	exit 1
}

names=()
currents=()
news=()
pkg_names=()

for name in "$@"; do
	dir="$root/plugins/$name"
	[ -f "$dir/package.json" ] || {
		echo "no package.json in plugins/$name" >&2
		exit 2
	}

	read_field() { node -p "const p=require('$dir/package.json'); String(p[$1] ?? '')"; }
	pkg_name="$(read_field "'name'")"
	current="$(read_field "'version'")"
	files="$(read_field "'files'")"

	case "$pkg_name" in @*/?*) ;; *)
		echo "not publish-ready: name is '$pkg_name', not a scoped @rizal72/<name> (docs/publishing.md)" >&2
		exit 1
		;;
	esac
	[ -n "$files" ] || {
		echo "not publish-ready: no 'files' whitelist (docs/publishing.md)" >&2
		exit 1
	}

	next="$(node -e '
  const [maj, min, pat] = process.argv[1].split(".").map(Number)
  const level = process.argv[2]
  if (level === "major") console.log(`${maj + 1}.0.0`)
  else if (level === "minor") console.log(`${maj}.${min + 1}.0`)
  else console.log(`${maj}.${min}.${pat + 1}`)
' "$current" "$level")"

	names+=("$name")
	currents+=("$current")
	news+=("$next")
	pkg_names+=("$pkg_name")
done

for i in "${!names[@]}"; do
	echo "${names[$i]}: ${currents[$i]} -> ${news[$i]} ($level)"
done
[ "$level" != major ] || echo "note: major declares the interface stable, it is not 'a big change'."

(cd "$root" && npm run check >/dev/null) || {
	echo "npm run check failed" >&2
	exit 1
}

if [ "${#names[@]}" -eq 1 ]; then
	read -r -p "bump ${names[0]} to ${news[0]}? [y/N] " ok || true
else
	read -r -p "bump ${#names[@]} packages? [y/N] " ok || true
fi
[ "$ok" = y ] || {
	echo "stopped, nothing changed."
	exit 1
}

for i in "${!names[@]}"; do
	# The version field alone, in place: `npm version` rewrites the whole file and loses the tabs.
	node -e '
const fs = require("fs")
const [file, next] = process.argv.slice(1)
const text = fs.readFileSync(file, "utf8")
const match = text.match(/"version":\s*"[^"]+"/)
if (!match) throw new Error(file + ": no version field")
const out = text.replace(match[0], `"version": "${next}"`)
if (out === text) throw new Error(file + ": version not replaced")
fs.writeFileSync(file, out)
' "$root/plugins/${names[$i]}/package.json" "${news[$i]}"
	(cd "$root/plugins/${names[$i]}" && npm pack --dry-run)
done

if [ "${#names[@]}" -eq 1 ]; then
	commit="Release ${names[0]} ${news[0]}"
else
	commit="Release ${#names[@]} packages"
fi

cat <<EOF

Nothing has been published. The lines left, run from the repository root:

  git add -A && git commit -m "$commit"
  git push origin main   # the push publishes on npm, with provenance

A direct \`npm publish\` still works, with the second factor.

Then:
EOF
for i in "${!names[@]}"; do
	echo "  npm view ${pkg_names[$i]} version   and   opencode plugin update"
done
