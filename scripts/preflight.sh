#!/bin/sh
# Refuses a push that would move a package's content without moving its version.
#
# npm does not publish a version twice, so a forgotten bump does not publish wrong code: it leaves npm on
# the old tarball while the repository shows the new sources — silently, until someone reports a bug that
# was already fixed. This is the check the mirror did before the push; it is the only gate left, and it
# runs by hand because the workflow sees the commit only after it is already on main.
#
#   scripts/preflight.sh        exit 1 and name the packages to bump
#   scripts/preflight.sh --allow   push anyway, for a change that does not move the package
set -eu

ALLOW=""
for arg in "$@"; do
	case "$arg" in
	--allow) ALLOW="yes" ;;
	*) echo "unknown option: $arg" >&2; exit 2 ;;
	esac
done

root=$(git rev-parse --show-toplevel)
cd "$root"

git fetch -q origin main 2>/dev/null || true
base=origin/main
git rev-parse --verify -q "$base" >/dev/null || { echo "no $base to compare against" >&2; exit 1; }

[ -z "$(git status --porcelain)" ] || {
	echo "uncommitted changes: they would not travel with the push" >&2
	exit 1
}

changed=$(git diff --name-only "$base"...HEAD)

blocked=""
for dir in plugins/*/; do
	plugin=$(basename "$dir")
	name=$(node -p "require('./${dir}package.json').name")
	case "$name" in @rizal72/*) ;; *) continue ;; esac
	printf '%s\n' "$changed" | grep -q "^plugins/$plugin/" || continue
	version=$(node -p "require('./${dir}package.json').version")
	shipped=$(
		git show "$base:plugins/$plugin/package.json" 2>/dev/null |
			node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{console.log(JSON.parse(s).version||"")}catch{console.log("")}})'
	)
	[ "$shipped" != "$version" ] && continue
	blocked="$blocked $plugin@$version"
done

if [ -n "$blocked" ]; then
	if [ "$ALLOW" = yes ]; then
		echo "warning: content without a version bump:$blocked — pushed anyway, npm stays where it is" >&2
		exit 0
	fi
	echo "the content moved but the version did not:" >&2
	for entry in $blocked; do
		echo "  $entry" >&2
		echo "    scripts/release.sh ${entry%@*} patch|minor|major" >&2
	done
	exit 1
fi

echo "preflight ok: every changed package carries a new version"
