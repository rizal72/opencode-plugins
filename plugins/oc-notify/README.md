# oc-notify

A notification on the phone when a turn ends while you are not at the computer, so you can start a task from
the mobile, close the phone, and know when it is over. A paired Apple Watch mirrors it, with the phone's screen
off.

It drives [ntfy](https://ntfy.sh), a free push channel for iOS and Android: the app is the notification, and
the Watch needs nothing installed of its own. The channel is external by necessity — iOS delivers a web push
only to a site installed in the home screen, and nothing in OpenCode's own window can push at all.

## Install

Not published yet: clone this repository and point one line in `~/.config/opencode/opencode.jsonc` at the
plugin's directory.

```jsonc
"plugins": ["/path/to/opencode-plugins/plugins/oc-notify"]
```

Then, on the phone: install **ntfy** from the App Store or Google Play, allow its notifications, and subscribe
to the topic you put in the configuration below. Under *Settings → Instant notifications* leave the default on
— that is what makes a message arrive with the app closed. Leave *Use another server* off unless you run your
own.

## Configure

Two ways to the same five keys, and neither is a copy: the desktop app's **Settings → Push notification**
writes the file, and the file is what the server reads. Pick whichever matches the client you use.

**In the desktop app**: three choices for when to notify, the minutes that count as away, the switch for the
session's title, and the topic.

**In the file**, which is also the only way for an install with no desktop app — a terminal-only setup needs
nothing else. `~/.config/opencode/oc-notify.json`, or `$XDG_CONFIG_HOME/opencode/oc-notify.json` if that is
set:

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
| `topic` | — | the ntfy topic to subscribe to. No file, no topic, no notification. `[-_A-Za-z0-9]`, up to 64 |
| `mode` | `always` | `always`, `away`, or `off` |
| `awayAfter` | `5` | minutes of no keyboard or mouse input that count as "away" |
| `includeTitle` | `false` | send the session's title, which is what says *which* session finished |
| `server` | `https://ntfy.sh` | a self-hosted ntfy instead; only the file takes this one |

The topic works as a password: whoever knows it can read what arrives on it. Treat it as one, and change it
if it leaks — then subscribe to the new one in the app.

The file is read at every prompt and every turn end, so an edit applies at the next turn with no restart. No
file, no channel: the absence of the file is the switch. A file that does not parse keeps the last settings
that did, and the notification's body ends with `config error` — a typo must not look like a quiet agent.

## Update

Nothing to update: a plugin loaded by path moves with the checkout. A published version would follow the usual
`opencode plugin check` / `opencode plugin update`, or
[`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates) for the count in the
app.

## How it decides

- **`always`** — every finished turn notifies.
- **`away`** — notifies when neither the start of the turn nor its end found you at the computer. Launching
  from the phone means the computer has been idle, so the turn counts as started away; launching at the desk
  and then leaving still notifies, because the end is away. Sitting and watching notifies nothing. `away` reads
  macOS's own idle counter, so outside macOS it degrades to `always`.
- **`off`** — nothing.

A turn that is interrupted or fails sends nothing, and neither does a compaction: the hook only runs when a
session really finishes model work. A background shell or subagent does not notify early — the hook runs again
when that work ends — and a subagent's own session never notifies, only the turn it belongs to.

## What leaves the machine

The topic, the session's title (only with `includeTitle`), the agent and the time. Nothing from the transcript
and nothing from a tool call. It travels in clear through ntfy.sh's relay on its way to Apple's or Google's push
service, and the relay caches it for twelve hours.

## Limits

- The trigger is a hook marked `experimental`, which promises nothing: a rename would silence the plugin in
  every mode until it is updated.
- The free ntfy.sh tier allows 250 messages a day per address.
- "Away" measures the computer, not the phone: on macOS a playing video keeps the idle counter at zero, so a
  session that ends while you watch one stays silent.
- The notification opens the ntfy app, not OpenCode: there is no durable link back to a session.
