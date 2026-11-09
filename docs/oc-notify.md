# oc-notify

**Status: published.** `@rizal72/oc-notify` on npm, so the README's npm column says so; a server half and a
settings page in the desktop app. No terminal half, on purpose.

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

## What `experimental` promises: nothing

Measured 2026-11-01 on 2.2.5. The word marks instability, not a name kept for compatibility, and the
deprecation runs the other way: a stable client method is deprecated *toward* `client.experimental.…` with
`Removed in the next minor` on it (`client/dist/effect/generated/client.d.ts`), and the stable `ctx.generate`
says `Use experimental.generate.text` (`promise/plugin.d.ts:44`). The loader resolves one GUI entry,
`gui-experimental`, and has no `gui` fallback (`plugin/dist/host.js:40`); the protocol states that experimental
routes carry "no compatibility promise" (`protocol/dist/groups/experimental.js:5`,
`protocol/dist/client.js:50-52`); and the V1 → V2 migration dropped experimental hooks rather than aliasing
them (`opencode.ai/v2/docs/build/plugins/migrate-v1`).

So what can break here, and is repaired by an update rather than by an old name still working:
`experimental.idle`, the `gui-experimental` entry, and every `@deprecated` alias. That is the whole promise.

## The rules

Config: `~/.config/opencode/oc-notify.json`, read at every turn end and on every `rpc` call and never cached — an
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
- The check and the claim on a session are contiguous, with no `await` between them: a gap there would let two
  instances through and produce two notifications.
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
- `Rpc.define` rejects a definition with no `events` key: the empty map is present on purpose, because a
  missing one fails the whole plugin.

## What leaves the machine

The topic, the session title (only with `includeTitle`), the agent and the time. Nothing from the transcript
and nothing from a tool call. It is clear text through ntfy.sh on its way to APNs, and the relay caches it
for twelve hours; anyone who knows the topic can subscribe and read it. The topic is chosen accordingly, and
it is the only protection: the free tier allows 250 messages a day per address. It lives in the config file
and nowhere else — never in this repository, never in a log.

## Limits

- **No way back into the session.** The web UI's route is `/server/:serverKey/session/:id`, and `serverKey`
  is a key of the client's own server list, which the server cannot know. A pair link is one-time and expires
  in five minutes, and `opencode://` carries no path. A `click` field could open the web UI at its root,
  where the session is picked from the list — not the session itself.
- A video playing keeps `HIDIdleTime` at zero, so a session ending while you watch one stays silent.
- Delivery to a closed app depends on ntfy.sh's APNs relay and on the app's *Instant notifications* setting.

## The page, and what is still missing

The file is the state; the page is the way in. It is a page of its own rather than a section of `General`,
so no host page grows a section for us. `rpc.ts` carries one `get` and one `set`, the page draws what
`get` returns and writes through `set`, so neither the page nor the command that comes later knows the file's
path or its shape. The server validates the input, because any client of the rpc can call it, and writes
atomically (`.tmp`, then `rename`), so an interrupted write cannot produce the half-written file the read path
has to forgive. `server` is not on the page: a self-hosted relay is already a person who edits files.

A row is the host's controls on our own layout — a title, the control, a muted note — because a settings page
gets no row component from the app; it contributes `Switch`, `TextInput`, `Menu`, `Button`, icons and dialogs
(`docs/gui-plugins.md`). `Switch` draws its label inline with the description beside it, which is why it takes
`hideLabel` here: the title is the row's, and mixing the two layouts is what made the first draft uneven.

A page lists **after the app's own pages**, with no group of ours: `group` takes one value, `about`, which puts
it below About, "for pages about the app itself". No plugins group exists, so a contributed page cannot
announce itself as one; pages of ours will simply sit together by the same rule.

Still missing: the `/push` command in the terminal, built on the same `rpc`. Nothing in the server half changes
when it arrives.
