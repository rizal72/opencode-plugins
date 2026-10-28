# oc-session-search

**Status: in use; published as `@rizal72/oc-session-search` (0.1.0, 0.1.1, `0.2.0` on 2026-10-27: the
ranking rewrite below, published before its review — `0.2.1` the same day carries the four defects that
review found).**

The `session_search` tool: keyword search over every past OpenCode session, so "we discussed this
already" can be answered instead of guessed. Ported from `pi-session-search` (Pi).

## Why a tool and not a command

The owner never has to remember a command: the agent reaches for the tool on its own when the phrase
"we already discussed this" appears. Registered with `codemode: true`, so it costs no prompt bytes — it
sits in the Code Mode catalog as one line, callable from `execute`.

## Where the transcripts are

`~/.local/share/opencode/opencode.db`, SQLite, table `session_message` (`data` is the JSON of one
message) joined with `session_v2` for directory and title. On Pi they were `.jsonl` files and `rg` did
the scan; here SQL does it. Overrides: `OPENCODE_DB`, else `$XDG_DATA_HOME/opencode/opencode.db`.

## How the search works

One scan, no index, ranked in three steps.

1. **The query becomes words.** Up to six, longest first — a longer word is usually the more selective
   one. A query that carries regex syntax (`.*+?^$()[]{}|\`) is run as that expression instead, unchanged.
   For a plural, the singular is searched too; substring matching already covers the other direction.
2. **SQL keeps the rows, the JS ranks them.** SQL scores by *presence* of each word, one column per
   word, and filters nothing else: it is deliberately loose (a superset), because `instr` finds "git"
   inside "digit". The word-bounded test runs in JS on the addresses that survive.
3. **Rarity decides.** Every message holding a word is a candidate, so the number of candidates holding
   word *i* is its exact document frequency — no second pass, no statistics table. Each word is weighted
   `log(1 + candidates / df)`: a word present in most messages counts almost nothing, a word present in a
   handful carries the ranking. Then: score, then date, then one hit per session before the cut, then the
   rest by rank with no per-session cap (a long session holding every mention may take the tail).

Prose comes before payload: a message is searched in its own text (`text`, or the `text`/`reasoning`
parts, never the `tool` parts); a match found only inside a tool call is kept as filler, after every
prose hit. The snippet centres on the rarest word present, not on the first match — the first match in a
message is usually "the".

Each hit gives date, project, session id, title, role and a snippet, plus how many sessions contain a
match. To read the whole session: `opencode api get /api/session/<id>/message`.

**Dates narrow the result, not the rows read.** `since` and `until` (YYYY-MM-DD, inclusive) filter in
SQL, but the scan still walks the whole rowid range: because the chunk is a rowid range, that range is
the access path, and the date test only saves the substring evaluation per row. Measured 2026-10-27,
four words: 231 ms unbounded against 190 ms for three days. It buys quiet, not speed — except for a
period with no sessions, which costs nothing. They used to filter in JS *after* the row cap, which could
answer "no match" for a period that had matches; that was a bug. A date that does not exist, and a
`since` later than its `until`, are both reported instead of silently returning nothing.

## No index, on purpose

An FTS5 index in a second file was measured and rejected: 24 MB today, ~1.4 s to build, ~0.2 ms per
query, and ~300 MB after a year of sessions at the current rate. The scan costs what the corpus costs and
writes nothing, which was worth more than the milliseconds. What was taken from that measurement is the
part that fixed the actual defect: rank across the whole corpus instead of truncating by recency.

Measured 2026-10-27, 10.3k messages, 193 sessions, 83 MB of JSON (14 MB of prose):

| query | before | after |
|---|---|---|
| `mirror github` (lives in 452 rows across 31 sessions) | 2 hits, 1 session, all today | 10 hits over 4 days, 56 sessions matched |
| `budget panel blank overnight` | 2 hits, today | 4 hits across 3 weeks |
| `il telefono non riesce ad aprire il QR di pairing` | 0 hits | 3 hits |
| a period with no sessions | "no match" for the 400 newest rows only | 0, in 55 ms |
| latency, 4 words | 13 ms | ~230 ms |
| latency, 6 words | 16 ms | ~350-460 ms |

**The cost that grows.** The scan is linear in the corpus: 78 MB of message text today, so 1-3 s at
200k messages (a year at this rate). The defence is the date range, which is the caller's to pass. There
is no default window on purpose: a default re-creates the same defect at 90-day scale instead of 400-row
scale.

## The stall, and why the scan is paged

`bun:sqlite` is synchronous, and a tool runs on the server's single thread
(`packages/core/src/session/runner/step.ts:123-133`). While a search runs, every HTTP request queues, the
event feed stops, the model's token stream pauses, and other sessions wait — measured: a cheap request
behind a burst of searches waited 200 ms.

So the scan reads `CHUNK = 1000` rows per statement and yields to the loop between them, the same batch
size the host uses for deletes (`EVENT_DELETE_BATCH_SIZE`). Paging costs nothing in total (201 ms in
chunks against 205 ms in one go, measured) and turns a solid block into ~20 ms slices: with one search in
flight, the worst wait for another request fell to 86 ms and the median to 1 ms. Five at once still share
the loop, and then the tail grows — the loop is one.

## Self-check

```
node plugins/oc-session-search/search.ts --self-check
```

Covers: hits exist, `limit` honoured, single-line snippets, session id present, a nonsense query finds
nothing, the project filter does not leak, a broken regex is reported instead of thrown, a malformed date
is reported, an impossible date and an inverted range are reported, a capitalised query must still find
the lowercase rows, a regex alternation must keep both branches, the project filter must return something,
a word spread across sessions must not come back as one day, a multi-word sentence must not come back
empty, and a bounded past period must be empty.

## Gotchas

- **The session in progress is searched by default**, and it is the loudest one: its own text holds the
  words just typed. That is deliberate — the owner's sessions are long and most discussions are in the
  same one — and the one-hit-per-session first pass keeps it from taking the whole list.
- **SQLite comes from the host, not from the machine.** `bun:sqlite` is inside the OpenCode binary, so the
  plugin needs nothing installed on any platform; the `sqlite3` CLI is only the fallback, and it is the
  path the self-check takes under `node` (one process per chunk, so the self-check is slow by design).
- The schema is internal to OpenCode: an upgrade can rename `session_message` or `session_v2`, and the
  tool then says so ("no such table") instead of returning stale results. The self-check is the fastest
  way to notice.
- Beyond 30k candidates the scan stops and the answer says so (one person's year of sessions is ~20k).
  The ranking's document frequency is then computed on the rows that were read.
- **Words are ASCII**: `terms()` takes runs of letters, digits and underscore, so `perché` searches
  `perch` (still a match, by substring) while a query written only in an ideographic or Cyrillic script
  has no term at all and is refused with a message.
- **The project filter is case-insensitive on both sides**, because `instr` is not: the directory is
  lowered in SQL. Before 0.2.1 it was not, and `project: "OpenCode"` silently selected only sandbox paths.
- The `role` field is the message type as the host stores it (`assistant`, `user`, `synthetic`, `shell`,
  `idle`, ...), not a normalised pair.

## Undo

Remove the `oc-session-search` line from `plugins` in `~/.config/opencode/opencode.jsonc`, then
`/restart`. The directory `plugins/oc-session-search/` can stay — nothing loads it without the config
line. Nothing is written anywhere.
