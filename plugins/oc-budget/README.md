# oc-budget

How much credit is left on the account behind the model you are using — a percentage for the Go subscription,
a dollar balance for Zen, DeepSeek or OpenRouter. It appears in the sidebar, in the footer, in the desktop
app's session header, and as `/budget` in the terminal.

It reads four wallets, and only the ones you have connected: **OpenCode Go** (the subscription's windows),
**Zen** (the pay-per-use credit), **DeepSeek** and **OpenRouter**. No configuration file of its own, no token
stored by the plugin: the credentials are OpenCode's, the ones you already put there with `opencode auth
login`.

## Install

```sh
opencode plugin add @rizal72/oc-budget
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-budget"]
```

Then connect the wallets you care about, exactly as you would without it:

```sh
opencode auth login                    # the list, then pick one
opencode auth login opencode-go        # the Go subscription
opencode auth login opencode           # the Console account: this is what reads Zen
opencode auth login deepseek
opencode auth login openrouter
```

Nothing else to configure. A wallet you never connected is simply not drawn.

## Update

V2 checks package plugins at startup and never applies the update, so a package only moves when you ask:

```sh
opencode plugin check     # which of the installed packages are behind
opencode plugin update    # apply them, and let the server reload
```

Or install [`@rizal72/oc-plugin-updates`](https://www.npmjs.com/package/@rizal72/oc-plugin-updates): the
count appears in a pill above the composer, with the update one click away.

## What it shows

| wallet | what it is | connected with | colour |
|---|---|---|---|
| `GO nn%` | the Go subscription, and which of its windows pays | a Go key, or the Console account | green under 90, yellow from 90, red at 100 |
| `ZEN $x.xx` | the pay-per-use credit | the Console account | green above $5, yellow at or below, red at 0 |
| `DS $x.xx` | the native DeepSeek balance | a DeepSeek key | green above $2, yellow at or below, red at 0 |
| `OR $x.xx` | OpenRouter credits | an OpenRouter key | green above $5, yellow at or below, red at 0 |

Go prints one line per window with its reset — `5h 4% reset 2h 10m`, `wk 31% reset 3d 14h`, `mo 16% reset
24d 3h` — and, when more than one Console account is connected, the workspace it is reading, by name. When the
monthly window is rate-limited the gateway falls back to the pay-per-use credit, so the widget shows ZEN: the
figure answers "who is paying", not "what did I subscribe to".

Each surface decides that from the model *it* is showing, because the terminal and the window have separate
model pickers on purpose. They agree on everything else.

## When something is missing, or wrong

The widget distinguishes the two, which is why it is worth a line.

- **Never connected → absent.** No line, no dash, no error. A dash would claim a reading that does not exist.
- **Connected but unreadable → its line, with the reason.** A fault is said, not hidden.
- **Zen is always there**, because it is OpenCode's own wallet: with no Console connection it reads `ZEN —`
  and says why, instead of disappearing.
- **Go hides when neither of its two paths can read it**, so a free account does not carry a permanent error.
- A reading is cached for five minutes; the tooltip and the block say how old it is rather than pretending it
  is fresh.

## DeepSeek's two tariffs

DeepSeek charges less outside its peak hours, and the plugin marks the peak on the DS line so a price you
did not expect is explained. The windows are DeepSeek's and are computed in UTC, which makes them right across
a DST change. A Chinese public holiday is not encoded, so it reads as peak: over-warning, which is the safe
direction.

## Adding a provider of your own

The snapshot is a list of wallets, and both surfaces draw whatever it carries — so a new wallet is one
resolver in the server half (`index.ts`: where to read it, which integration holds the key), one entry in the
threshold table and one name in the paying-wallet rule (`budget.ts`). Fork the repository, add those three,
and the surfaces follow without being touched.

## Limits

- The four wallets are the four implemented. A provider outside them is not shown, and its model's row is the
  model's name without a figure — the plugin never guesses a balance.
- OpenCode Go's numbers come from the Console when it is connected and from the public usage endpoint
  otherwise; the two round differently by a percent, and the public one rounds down.
- Every figure is read from the provider's own endpoint, so a change on their side arrives as a fault on that
  line, not as silence.
