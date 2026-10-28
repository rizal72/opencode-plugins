#!/bin/sh
# The plugin SDK's version tracks the app's. Types behind the running OpenCode are an API that looks
# missing rather than old, which is how a two-minor gap reads as "this export does not exist".
set -u
app=$(opencode --version 2>/dev/null | sed -n 's/^opencode v//p')
types=$(node -p "require('./node_modules/@opencode/plugin/package.json').version" 2>/dev/null)
if [ -z "$app" ] || [ -z "$types" ]; then
	echo "check-sdk: cannot read a version (app='$app', types='$types')"
	exit 1
fi
if [ "$app" != "$types" ]; then
	echo "check-sdk: @opencode/plugin $types, opencode $app"
	echo "  npm install -D @opencode/plugin@latest"
	exit 1
fi
echo "check-sdk ok: @opencode/plugin $types"
