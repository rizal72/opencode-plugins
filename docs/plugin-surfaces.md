# Client surfaces — the record

A plugin package has three parts: the **server**, which owns state, and two clients that draw it — the
terminal (`tui.tsx`, `docs/tui-plugins.md`) and the desktop window (`gui.tsx`, `docs/gui-plugins.md`).
This record holds what the two clients share; each surface keeps its own traps.

## One server, many clients

The clients own no state: what they draw comes from the server over the package's `rpc.ts`, and the server
is one process for the whole machine. Each client keeps only its **last reading** and refreshes it on its
own clock, so a change made on the server — a switch turned off, an update that landed — reaches the window
or the terminal at the next tick, never the instant it happens. That is why a test switch has to reach the
service, and why the service is the thing to restart — never the window.

The service is spawned by the first client that needs one and inherits *that* client's environment, so a
client left open respawns a clean service the moment it is stopped, and `opencode service restart` keeps
the same process image and cannot carry an environment either (measured 2026-10-30, twice). One command
does the whole pass:

```sh
scripts/oc-dev-env.sh on OC_PLUGIN_UPDATES_DEV=outdated   # closes the clients, restarts the service,
                                                          # reads the variable back from its process
scripts/oc-dev-env.sh off                                 # stops the service; the next client starts clean
```

It finds clients by **connection** to the service port, not by process name — the terminal runs
`opencode -c`, and a desktop window closed to the background can leave processes behind — closes them,
starts the service detached with the variables, and verifies by reading the environment of the process
that is now listening. A variable that did not arrive says so; it never looks like a success. It reopens
what it closed: the app through its bundle, a terminal in a new Ghostty window on the same command line.
`--help` names the shape.

## A slot exists only where its surface exists

Every surface a plugin draws into hangs off a screen, and the screens do not all exist at once.

| surface | exists on | documented as |
|---|---|---|
| TUI `app`, `home.footer`, `home.footer.status` | the home screen | TUI plugins, *Slots* |
| TUI `sidebar.content`, `sidebar.footer`, `session.composer.top` | a session | TUI plugins, *Slots* |
| GUI `ComposerPill` | a mounted session composer | GUI plugins, *Composer pills* |
| GUI panels, `session.header`, `session.panel.end` | a session | GUI plugins, *Panels*, *Slots* |
| GUI `window.bottom` | the window | GUI plugins, *Slots* |
| GUI `session.location.menu` | a session | GUI plugins, *Slots* |

So a plugin that draws in the sidebar or on a pill has nowhere to be until a session exists: a client opened
fresh sits on its own start screen, and **nothing of ours can be on it**. In the terminal that means until
a message has been sent (measured 2026-10-30: the line appeared with the first prompt, never before). A
surface that has to be visible earlier belongs in a home or window slot, not in a session one.
