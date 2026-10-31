# oc-notify

A notification on the phone when a turn ends, so you can launch from the mobile, close the phone, and know
when to come back and read.

Server half only: there is nothing to draw in the terminal and nothing to draw in the desktop app. It drives
[ntfy](https://ntfy.sh), a free push channel for iOS and Android — the app is the notification, and the
Apple Watch mirrors it without a separate app.

## Why ntfy and not a web push

iOS delivers a web push only to a site installed in the home screen (service worker, VAPID, a user gesture
for the permission), and `new Notification()` has no supported path at all in Safari or in a webview. The
desktop app's browser pane cannot push either: the app ships `sw.js` and `site.webmanifest` and nothing in it
references `pushManager` or `showNotification`. An external relay with its own APNs credentials is the only
route to the lock screen, so it is the one taken.

## Install

Nothing is published yet; the repository's copy is loaded by path:

```jsonc
"plugins": ["/Users/riccardosallusti/Documents/_PROGETTI/opencode-plugins/plugins/oc-notify"]
```

## Set up the phone

1. Install **ntfy** from the App Store, and let it send notifications. Under *Settings → Instant
   notifications* leave the default on: that is what makes a message arrive with the app closed.
2. In the app, subscribe to the topic you put in the config below. The topic **is** the password — anyone
   who knows it can read what it caches and post into it — so pick something not derived from a public
   handle. Leave *Use another server* off unless you run your own.
3. Also on the Watch: nothing to install. iOS mirrors the iPhone's notifications, and the Watch shows them
   with the phone's screen off.

## Configure

`~/.config/opencode/oc-notify.json` (`$XDG_CONFIG_HOME/opencode/oc-notify.json` if that is set):

```json
{
	"topic": "a-topic-only-you-know",
	"mode": "away",
	"awayAfter": 5,
	"includeTitle": true,
	"server": "https://ntfy.sh"
}
```

| key | default | what it does |
|---|---|---|
| `topic` | — | the ntfy topic. No file, no topic, no notification. `[-_A-Za-z0-9]`, up to 64 |
| `mode` | `always` | `always`, `away`, or `off` |
| `awayAfter` | `5` | minutes of no keyboard or mouse input that count as "away" |
| `includeTitle` | `false` | send the session's title, which is what says *which* session finished |
| `server` | `https://ntfy.sh` | point it at a self-hosted ntfy instead |

The file is read at every prompt and every turn end, so an edit applies at the next turn with no restart. No
file, no channel: the absence of the file is the switch. A file that does not parse keeps the last settings
that did, and the notification's body ends with `config error` — a typo must not look like a quiet agent.

## How it decides

- **`always`** — every finished turn notifies.
- **`away`** — notifies when neither the start of the turn nor its end found you at the Mac. Launching from
  the phone means the Mac has been idle, so the turn counts as started away; launching at the Mac and then
  leaving still notifies, because the end is away. Sitting and watching notifies nothing. On a machine
  without `ioreg` the mode degrades to `always`.
- **`off`** — nothing.

A turn that is interrupted or fails sends nothing, and neither does a compaction: the hook only runs when a
session really finishes model work. A background shell or subagent does not notify early — the hook runs
again when that work ends — and a subagent's own session never notifies, only the turn it belongs to.

## What leaves the machine

The topic, the session title (only with `includeTitle`), the agent and the time. Nothing from the transcript,
nothing from a tool call. It travels in clear through ntfy.sh's relay on its way to Apple's push service, and
the relay caches it for twelve hours.

## Limits

- The hook is `experimental.idle`: the host may rename it, and the plugin would then go quiet, in every
  mode, until it is updated.
- The free ntfy.sh tier allows 250 messages a day per address, and a topic idles for longer than that.
- "Away" measures the Mac, not the phone: a video playing keeps the idle counter at zero, so a session that
  ends while you watch one stays silent.
