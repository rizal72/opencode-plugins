# oc-notify

**Status: in use, private.** Not published, so the README's npm column says so; loaded by path from
`plugins/oc-notify`, only `index.ts` — no terminal half and no desktop half.

A notification on the phone when a turn ends while you are not at the Mac, so a task started from the
mobile can be abandoned and picked up when it is over. The Apple Watch shows it as a mirrored
notification, with the phone's screen off and no watch app.

## The channel: ntfy, not web push

iOS delivers a web push only to a site installed in the home screen — a service worker, a VAPID pair and a
user gesture for the permission — and `new Notification()` has no supported path in Safari or in a webview.
The desktop app's browser pane cannot push either: the host ships `sw.js` and `site.webmanifest` and nothing
in it references `pushManager` or `showNotification`. An external relay with its own APNs credentials is the
only route to the lock screen, and ntfy.sh is that relay here.

A self-hosted ntfy needs `upstream-base-url: https://ntfy.sh` to reach iOS at all; without it the app polls
and the notification arrives hours late. That is the whole reason a self-hosted instance looks broken.

## The trigger

`ctx.session.hook("experimental.idle", …)` — `session.d.ts:155-170`. It runs when a Session finishes model
work and has no pending input, and **not** after an interruption, a failure or a control-only compaction: a
stopped turn is silent by construction, not by a filter of ours. It is marked experimental, so a rename
would silence the plugin in every mode until it is updated.

The noisier fallback, `ctx.event.subscribe({ types: ["session.status"] })` filtered on
`status.type === "idle"`, fires exactly on the cases we do not want, so it was not used.

## The rules

Config: `~/.config/opencode/oc-notify.json`, read at every prompt and every turn end and never cached — an
edit applies at the next turn, with no restart.

| key | default | meaning |
|---|---|---|
| `topic` | — | the ntfy topic; absent or outside `[-_A-Za-z0-9]{1,64}`, the plugin is silent |
| `mode` | `always` | `always`, `away`, `off` |
| `awayAfter` | `5` | minutes of no input that count as away |
| `includeTitle` | `false` | send the session's title |
| `server` | `https://ntfy.sh` | a self-hosted relay |

The body is `finished HH:MM · <agent>`; the title is the session's, or `OpenCode`. No file is no channel. A
file that does not parse keeps the last settings that parsed and appends `— config error` to the body: the
one failure that would otherwise be indistinguishable from an agent still working.

## "Away" is measured on the Mac, not on the phone

No client identity exists: nothing in `@opencode/{client,schema,protocol}` carries a presence, a user agent,
a device id or a session's origin, and `SessionInbox.Delivery` is only `steer | queue`. The phone cannot be
detected. `away` measures the complement: the turn counts as started away if the Mac had been idle when its
prompt was admitted, and as ended away if it is idle when the hook runs; either one notifies. Turning the
display off by hand leaves the last HID event at the mouse movement, so a dark screen is away.

Measured 2026-11-01, `ioreg -c IOHIDSystem`: `HIDIdleTime` grew 15.06 s in 15 s with
`PreventUserIdleSystemSleep 1` and `PreventUserIdleDisplaySleep 1` asserted — the host's "keep the Mac awake
while OpenCode is active" setting does not freeze the counter, so it does not make you permanently present.
One `ioreg` call costs 31 ms. On a machine without it the mode degrades to `always`: one push too many
beats a plugin that never speaks.

## One push, never two

- The loader instantiates a plugin once per open location — four identical loads of this one were in the log
  at once — so the sent-map lives on the process, behind `Symbol.for("oc-notify.machine")`.
- The claim on a session is taken **synchronously, before the first `await`** in the handler: a claim after
  a read would let two instances through and produce two notifications.
- Work still owned by the session silences the push, because the hook runs again when it ends: a background
  shell or a subagent would otherwise be announced as finished. A descendant's work is listed in
  `background` for information only (`session.d.ts:161-164`) and does not silence it.
- A child session never notifies: `parentID` is set, and its parent's hook reports the work.

Measured 2026-11-01, with `awayAfter: 0` so that absence could not mask anything: the turn that launched a
60 s background shell sent nothing; the shell's completion woke the session, and the notification arrived
once, at the end of the turn that followed it. A subagent finishing on its own sent nothing.

## Traps

- `ctx.session.get` takes `{ sessionID }`, not a string (`generated/client.d.ts:235`). A string fails the
  request, and a `.catch` around it turns the failure into a silent `return` — the first run sent nothing
  and logged nothing.
- A plugin's `console.error` has not been seen in `~/.local/share/opencode/log/opencode.log`. The observable
  of a send is the topic's own cache: `curl "https://ntfy.sh/<topic>/json?poll=1"`.
- HTTP headers do not carry UTF-8 reliably, so the message is published as JSON to `https://ntfy.sh/`: the
  title survives accents, and the topic stays out of the URL and out of the relay's access log.

## What leaves the machine

The topic, the session title (only with `includeTitle`), the agent and the time. Nothing from the transcript
and nothing from a tool call. It is clear text through ntfy.sh on its way to APNs, and the relay caches it
for twelve hours; anyone who knows the topic can subscribe and read it. The topic is chosen accordingly, and
it is the only protection: the free tier allows 250 messages a day per address.

## Limits

- **No way back into the session.** The web UI's route is `/server/:serverKey/session/:id`, and `serverKey`
  is a key of the client's own server list, which the server cannot know. A pair link is one-time and expires
  in five minutes, and `opencode://` carries no path. A `click` field could open the web UI at its root,
  where the session is picked from the list — not the session itself.
- A video playing keeps `HIDIdleTime` at zero, so a session ending while you watch one stays silent.
- Delivery to a closed app depends on ntfy.sh's APNs relay and on the app's *Instant notifications* setting.

## The switch, later

The config file is the switch today. A desktop `SettingsPage` (the CRT plugin shows that surface) and a
`/push` command in the terminal would both write that same file through one `rpc` contract; the contract is
not written yet, because nothing would call it.
