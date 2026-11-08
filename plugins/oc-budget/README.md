# oc-budget

How much credit is left on the account behind the model you are using — a percentage for the Go subscription,
a dollar balance for the Console's credits, DeepSeek or OpenRouter. It appears in the sidebar, in the footer,
in the desktop app's session header, and as `/budget` in the terminal.

It reads four wallets, and only the ones you have connected: **OpenCode Go** (the subscription's windows),
**OC credits** (the Console's prepaid balance), **DeepSeek** and **OpenRouter**. No configuration file of its
own, no token stored by the plugin: the credentials are OpenCode's, the ones you already put there with
`opencode auth login`.

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
opencode auth login opencode           # the Console account: this is what reads the credits
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
| `GO nn%` | the Go subscription, with one bar per window | a Go key, or the Console account | green under 90 on all three, yellow when any is at 90, red when any is spent |
| `OC $x.xx` | the Console's prepaid credits | the Console account | green above $5, yellow at or below, red at 0 |
| `DS $x.xx` | the native DeepSeek balance | a DeepSeek key | green above $2, yellow at or below, red at 0 |
| `OR $x.xx` | OpenRouter credits | an OpenRouter key | green above $5, yellow at or below, red at 0 |

Go prints a bar for each of its three windows, with the reset on the next line under it — `5h ████████████████████ 2%`
and its countdown below — and, when more than one Console account is connected, the workspace it is reading, by
name. The colour is the window that stops the subscription first: green while all three are under 90, yellow
once any is at 90, red once any is spent. The **figure** stays the month, because the three percentages are
shares of three different limits (the 5 hour window is 20% of the monthly limit, the week 50%), so a 5 hour
window at 62% is a month at 12%; the hover hint names the window that is sounding.

Reaching any of the three limits stops the subscription's requests, unless the Console's **Extra Usage**
toggle is on — off by default on Go and Go Plus — in which case they continue on the prepaid balance. The
widget cannot see that toggle, so it never claims the credits are paying: a spent window is red, and the
credits keep their own line.

Each surface decides that from the model *it* is showing, because the terminal and the window have separate
model pickers on purpose. They agree on everything else.

## When something is missing, or wrong

The widget distinguishes the two, which is why it is worth a line.

- **Never connected → absent.** No line, no dash, no error. A dash would claim a reading that does not exist.
- **Connected but unreadable → its line, with the reason.** A fault is said, not hidden.
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
