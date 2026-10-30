#!/bin/sh
# Turns a plugin's test switch on, or the machine back to normal.
#
#   scripts/oc-dev-env.sh on OC_PLUGIN_UPDATES_DEV=outdated [ANOTHER=value ...]
#   scripts/oc-dev-env.sh off
#
# Why `on` closes the clients first: the service is spawned by a client, with *that* client's environment,
# so a client left open respawns a clean service the moment it is stopped and the variables never arrive
# (measured 2026-10-29 four times, and again 2026-10-30: the TUI owned the service and brought it back
# without the variable). `opencode service restart` keeps the same process image, so it cannot carry an
# environment either.
#
# Clients are found by asking the service who is connected to its port, not by guessing from process
# names: the terminal runs `opencode -c`, the desktop app is Electron and its helper processes share the
# bundle path. Both are closed, the desktop named separately because it can be open with no session loaded.
#
# The verification is the point. `on` reads the variables back from the environment of the process now
# listening, so a variable that did not arrive says so instead of looking like a success. `off` stops the
# service and nothing else: the next client starts a clean one.
set -eu

usage() {
	sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

[ $# -ge 1 ] || usage 2
mode=$1
shift

# Detached: the caller is usually a client of the service this script is about to stop, so the parent
# shell can die halfway. The child survives it; the log is the record either way.
if [ "${OC_DEV_ENV_DETACHED:-}" != 1 ]; then
	OC_DEV_ENV_DETACHED=1 nohup sh "$0" "$mode" "$@" >/tmp/oc-dev-env.log 2>&1 &
	child=$!
	wait $child 2>/dev/null || true
	cat /tmp/oc-dev-env.log 2>/dev/null
	exit 0
fi

case "$mode" in
-h | --help | help) usage 0 ;;
on)
	[ $# -ge 1 ] || {
		echo "oc-dev-env: on needs at least one VAR=value" >&2
		exit 2
	}
	for pair in "$@"; do
		case "$pair" in *=*) ;; *)
			echo "oc-dev-env: '$pair' is not VAR=value" >&2
			exit 2
			;;
		esac
	done
	;;
off) [ $# -eq 0 ] || usage 2 ;;
*) usage 2 ;;
esac

port=$(opencode service status 2>/dev/null | sed -n 's|.*:\([0-9]*\)$|\1|p' || true)
server=$(opencode api get /api/info 2>/dev/null | sed -n 's/.*"pid":\([0-9]*\).*/\1/p' || true)

# What gets closed is put back at the end: a client left closed is a window the owner reopens by hand.
reopen_app=/tmp/oc-dev-env.app
reopen_tui=/tmp/oc-dev-env.tui
rm -f "$reopen_app" "$reopen_tui"

# Whoever holds a connection to the port, plus the desktop's main process: a closed window is not a
# closed app, and the Electron helpers share the bundle path, so the pattern covers all of them.
close_clients() {
	connected=""
	if [ -n "$port" ]; then
		connected=$(lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1{print $2}' || true)
	fi
	app=$(pgrep -f '/Applications/OpenCode\.app/' 2>/dev/null || true)
	clients=""
	for pid in $(printf '%s\n' "$connected" | sort -un) $app; do
		[ "$pid" = "$server" ] && continue
		clients="$clients $pid"
	done
	clients=$(printf '%s\n' $clients 2>/dev/null | sort -un | tr '\n' ' ')
	[ -n "$(echo "$clients" | tr -d ' ')" ] || return 1
	for pid in $clients; do
		name=$(ps -o comm= -p "$pid" 2>/dev/null || echo "pid $pid")
		args=$(ps -o args= -p "$pid" 2>/dev/null || true)
		case "$args" in
		*/Applications/OpenCode.app/*) : >"$reopen_app" ;;
		*) [ -n "$args" ] && printf '%s\n' "$args" >>"$reopen_tui" ;;
		esac
		kill "$pid" 2>/dev/null && echo "closed $name (pid $pid)"
	done
	i=0
	while [ $i -lt 40 ]; do
		alive=""
		for pid in $clients; do
			kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
		done
		[ -z "$alive" ] && return 0
		sleep 0.25
		i=$((i + 1))
	done
	for pid in ${alive:-}; do
		kill -9 "$pid" 2>/dev/null && echo "force-closed pid $pid"
	done
	sleep 0.5
	return 0
}

# `off` needs none of this: a client that respawns a clean service is exactly what turning the switch off
# means, so it only stops the service and leaves every window alone.
if [ "$mode" = off ]; then
	opencode service stop >/dev/null 2>&1 || true
	echo "off: the next client starts a clean service"
	exit 0
fi

# Three rounds: a client that was closed can still be restarted by the desktop's own supervisor, and a
# service that comes back is a service that comes back without the variables.
round=0
while [ $round -lt 3 ]; do
	close_clients || {
		[ $round -eq 0 ] && echo "no client connected"
		break
	}
	opencode service stop >/dev/null 2>&1 || true
	round=$((round + 1))
done

# Detached: the caller is a client too, and it is about to be closed by the loop above.

# Its own process group: the caller is a client too, and it is about to die with the service.
env "$@" opencode service start >/dev/null 2>&1 || {
	echo "oc-dev-env: the service did not start" >&2
	exit 1
}

pid=$(opencode api get /api/info 2>/dev/null | sed -n 's/.*"pid":\([0-9]*\).*/\1/p')
[ -n "$pid" ] || {
	echo "oc-dev-env: no service is answering after the start" >&2
	exit 1
}

missing=""
for pair in "$@"; do
	name=${pair%%=*}
	want=${pair#*=}
	got=$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$name=//p" | head -1)
	[ "$got" = "$want" ] || missing="$missing $pair (asked $want, found '${got-<none>}')"
done

if [ -n "$missing" ]; then
	echo "oc-dev-env: service pid $pid started, but the variables did not arrive:$missing" >&2
	echo "  a client came back and respawned it; close everything and run again" >&2
	exit 1
fi

# Put back what was closed, mirroring the command line: the desktop through its bundle, a terminal in a
# new Ghostty window running exactly what was running. A terminal that cannot be reopened is printed.
if [ -f "$reopen_app" ]; then
	open -a OpenCode 2>/dev/null && echo "reopened the desktop app"
fi
if [ -s "$reopen_tui" ]; then
	if command -v ghostty >/dev/null 2>&1; then
		while IFS= read -r line; do
			[ -n "$line" ] || continue
			# Deliberate word splitting: a command line, not one argument.
			open -na Ghostty --args -e $line 2>/dev/null && echo "reopened: $line"
		done <"$reopen_tui"
	else
		echo "reopen with: $(tr '\n' ' ' <"$reopen_tui")"
	fi
fi
rm -f "$reopen_app" "$reopen_tui"

echo "on: service pid $pid, $*"
