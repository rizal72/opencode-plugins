#!/bin/sh
# Turns a plugin's test switch on, or the machine back to normal.
#
#   scripts/oc-dev-env.sh on OC_PLUGIN_UPDATES_DEV=outdated [ANOTHER=value ...]
#   scripts/oc-dev-env.sh off
#
# OpenCode is one server and many clients. The service is spawned by the first client that needs one and
# inherits *that* client's environment, and `opencode service restart` keeps the same process image — so
# neither can carry a variable. The only way is: no client alive, service stopped, service started by us.
# Everything below exists to make those three conditions true and then to prove it.
set -eu

usage() {
	sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

[ $# -ge 1 ] || usage 2
mode=$1
shift

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
		# The verification reads the environment out of `ps`, which prints it space-separated: a value
		# holding a space cannot be told from the next variable, so it is refused instead of misreported.
		case "$pair" in *" "*)
			echo "oc-dev-env: '$pair' has a space; only single-token values can be verified" >&2
			exit 2
			;;
		esac
	done
	;;
off) [ $# -eq 0 ] || usage 2 ;;
*) usage 2 ;;
esac

# Detached, because the caller is usually a client of the service this script is about to stop: the parent
# shell can die halfway and the child would die with it. The child writes the log; the parent prints it.
if [ "${OC_DEV_ENV_DETACHED:-}" != 1 ]; then
	work=$(mktemp -d "${TMPDIR:-/tmp}/oc-dev-env.XXXXXX")
	log="$work/log"
	OC_DEV_ENV_DETACHED=1 OC_DEV_ENV_WORK="$work" nohup sh "$0" "$mode" "$@" >"$log" 2>&1 &
	child=$!
	wait $child 2>/dev/null || true
	cat "$log" 2>/dev/null
	echo "log: $log"
	exit 0
fi

work=${OC_DEV_ENV_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/oc-dev-env.XXXXXX")}
reopen_app="$work/app"
reopen_tui="$work/tui"

# The port the service writes its own state with, and the pid listening on it. Read from `lsof`, not from
# `api get`: that command may start a service when none is up, which is a measurement creating its subject.
service_port() {
	opencode service status 2>/dev/null | sed -n 's|.*:\([0-9]*\)$|\1|p' | head -1
}

listen_pid() {
	[ -n "${1:-}" ] || return 1
	lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | head -1
}

# Whoever holds a connection to the port, plus the desktop app: a closed window is not a closed app, and
# the Electron helpers share the bundle path. The port and the pid are re-read on every round, because a
# client that came back has come back on a service we have not seen yet.
close_clients() {
	port=$(service_port)
	server=$(listen_pid "$port" || true)
	connected=""
	if [ -n "$port" ]; then
		connected=$(lsof -nP -iTCP:"$port" -sTCP=ESTABLISHED 2>/dev/null | awk 'NR>1{print $2}' || true)
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
		cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
		case "$args" in
		*/Applications/OpenCode.app/*) : >"$reopen_app" ;;
		*) [ -n "$args" ] && printf '%s\t%s\n' "${cwd:-$PWD}" "$args" >>"$reopen_tui" ;;
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

round=0
while [ $round -lt 3 ]; do
	close_clients || {
		[ $round -eq 0 ] && echo "no client connected"
		break
	}
	sleep 0.3
	round=$((round + 1))
done

# Unconditionally: a first run finds no client and must still stop the service, or `service start` meets a
# service that is already up and does nothing, and the verification blames a client for the script's own skip.
opencode service stop >/dev/null 2>&1 || true

# `service start` is documented as "start the background server", not as replacing one, so wait until the
# service is really gone before asking for another: the port free *and* no process waiting to be it.
port=$(service_port)
i=0
while { [ -n "$port" ] && [ -n "$(listen_pid "$port" || true)" ]; } || pgrep -f 'serve --service' >/dev/null 2>&1; do
	if [ $i -ge 20 ]; then
		echo "oc-dev-env: a service is still running" >&2
		exit 1
	fi
	sleep 0.25
	i=$((i + 1))
done

env "$@" opencode service start >/dev/null 2>&1 || {
	echo "oc-dev-env: the service did not start" >&2
	exit 1
}

port=$(service_port)
pid=$(listen_pid "$port" || true)
[ -n "${pid:-}" ] || {
	echo "oc-dev-env: no service is listening after the start" >&2
	exit 1
}

missing=""
for pair in "$@"; do
	name=${pair%%=*}
	want=${pair#*=}
	got=$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\n' | sed -n "s/^${name}=//p" | head -1)
	[ "$got" = "$want" ] || missing="$missing $pair (asked $want, found '${got-<none>}')"
done

if [ -n "$missing" ]; then
	echo "oc-dev-env: service pid $pid started, but the variables did not arrive:$missing" >&2
	echo "  a client came back and respawned it; close everything and run again" >&2
	exit 1
fi

# Put back what was closed, mirroring the command line and its directory: the desktop through its bundle, a
# terminal in a new Ghostty window. The command goes through `sh -c`, so it is only reused when it holds
# nothing a shell would act on; anything else is printed instead of run — `ps` flattens argv, and a line
# with `$( )` or `;` must not become code because a window was closed.
if [ -f "$reopen_app" ]; then
	open -a OpenCode 2>/dev/null && echo "reopened the desktop app"
fi
if [ -s "$reopen_tui" ]; then
	while IFS="$(printf '\t')" read -r dir cmd; do
		[ -n "${cmd:-}" ] || continue
		# Letters, digits, space, slash, dot, underscore, hyphen: nothing else may reach a shell.
		plain=$(printf '%s %s' "$dir" "$cmd" | tr -d 'A-Za-z0-9 /._-')
		if [ -n "$plain" ] || ! command -v ghostty >/dev/null 2>&1; then
			echo "reopen by hand: cd \"$dir\" && $cmd"
			continue
		fi
		open -na Ghostty --args -e sh -c "cd \"$dir\" && exec $cmd" 2>/dev/null && echo "reopened: $cmd"
	done <"$reopen_tui"
fi

echo "on: service pid $pid, $*"
