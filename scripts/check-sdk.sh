#!/bin/sh
# The plugin SDK's version tracks the app's. Types behind the running OpenCode are an API that looks
# missing rather than old, which is how a two-minor gap reads as "this export does not exist".
#
# The app is the *server* that loads the halves, not the `opencode` binary on PATH: a CLI left behind
# while the desktop updated itself measures the wrong thing, and the gate passes when it should fail
# (measured 2026-10-30: CLI 2.2.2, app 2.2.3, check green).
set -u
types=$(node -p "require('./node_modules/@opencode/plugin/package.json').version" 2>/dev/null)
where=server
app=$(opencode api get /api/info 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
if [ -z "$app" ]; then
	# Nothing is running: the CLI is all there is to ask, and it is what would start the server.
	where=cli
	app=$(opencode --version 2>/dev/null | sed -n 's/^opencode v//p')
fi
if [ -z "$app" ] || [ -z "$types" ]; then
	echo "check-sdk: cannot read a version (app='$app', types='$types')"
	exit 1
fi
if [ "$app" != "$types" ]; then
	echo "check-sdk: @opencode/plugin $types, opencode $app (from the $where)"
	echo "  npm install -D @opencode/plugin@latest"
	exit 1
fi
echo "check-sdk ok: @opencode/plugin $types"
