# @rizal72/oc-session-search

Adds one tool, `session_search`: a keyword search over the transcripts of past sessions, so the agent can
answer "we discussed this already" without being told which file or command to look in.

No surface, on purpose: the tool is the whole plugin. There is nothing to draw in the terminal and nothing
to draw in the desktop app.

## Install

```sh
opencode plugin add @rizal72/oc-session-search
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-session-search"]
```

Nothing to configure and nothing to enable: the tool registers itself, and it is a Code Mode tool, so it
costs one line of the catalog rather than a full schema in every prompt.

## How it works

The query is split into words (up to six, longest first) and every message is scored by which of them it
holds: a word rare in the corpus counts more than a word present everywhere, so `why the panel went blank`
does not match everything through "the". A query carrying regex syntax is used as that expression instead.
Each result gives date, project, session id, title, role and a snippet, and the header says how many
sessions contain a match.

Narrow it when you remember roughly when — the search gets cheaper and quieter:

| input | what it does |
|---|---|
| `query` | words, or a regular expression |
| `project` | substring of the session's directory, e.g. `OpenCode` |
| `since` | earliest date, `YYYY-MM-DD`, inclusive |
| `until` | latest date, `YYYY-MM-DD`, inclusive |
| `limit` | max hits, default 10, max 40 |

It reads the database at `$OPENCODE_DB`, else `$XDG_DATA_HOME/opencode/opencode.db`, else
`~/.local/share/opencode/opencode.db` — opened read-only. SQLite comes from the host itself
(`bun:sqlite`), so no external binary is needed; the `sqlite3` CLI is only a fallback.

Nothing is written, and there is no index to build or keep in sync: the whole corpus is scanned per search,
in chunks, so a long search does not freeze the server. The price is that a search costs what the corpus
costs — a fraction of a second today, seconds once the transcripts are large. Pass `since`/`until` when you
can.

Two honest limits: an empty result may mean the schema moved rather than no match, and the message table is
internal to OpenCode, so a release can change it.
