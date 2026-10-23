# @rizal72/oc-session-search

Adds one tool, `session_search`: a keyword search over the transcripts of past sessions, so the agent
can answer "we discussed this already" without being told which file or command to look in.

The search takes a case-insensitive regular expression, and optionally a project substring and an
earliest date. It returns the date, project, session id, title, role and a raw snippet, newest first.

## Install

```sh
opencode plugin add @rizal72/oc-session-search
```

Or by hand, one line in `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugins": ["@rizal72/oc-session-search"]
```

Nothing to configure and nothing to enable: the tool registers itself, and it is a Code Mode tool, so
it costs one line of the catalog rather than a full schema in every prompt.

## Where it looks

The database at `$OPENCODE_DB`, else `$XDG_DATA_HOME/opencode/opencode.db`, else
`~/.local/share/opencode/opencode.db` — opened read-only. SQLite comes from the host itself
(`bun:sqlite`), so no external binary is needed; the `sqlite3` CLI is only a fallback.

Two honest limits: an empty result may mean the schema moved rather than no match, and the message
table is internal to OpenCode, so a release can change it.
