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
# The CLI on PATH is a second server waiting to be started: one that lags the app loads the halves
# against older types. So the gate repairs it here, once, instead of asking — and never downwards: a CLI
# ahead of the app is an app left behind, and downgrading the CLI is not that repair.
if [ "$where" = server ]; then
	cli=$(opencode --version 2>/dev/null | sed -n 's/^opencode v//p')
	if [ -n "$cli" ] && [ "$cli" != "$app" ]; then
		lowest=$(printf '%s\n%s\n' "$cli" "$app" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)
		if [ "$lowest" = "$cli" ]; then
			echo "check-sdk: the app is $app but the CLI on PATH is $cli — upgrading it"
			opencode upgrade "$app" >/dev/null 2>&1 || echo "check-sdk: the upgrade failed; run opencode upgrade $app"
		else
			echo "check-sdk: the CLI on PATH is $cli, ahead of the app at $app — left alone"
		fi
	fi
fi
echo "check-sdk ok: @opencode/plugin $types"
