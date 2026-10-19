# `ops/` agent state

Working state for the director and staff agents (`docs/staff-handbook.md`). Nothing here is project
documentation; that lives in `CLAUDE.md` and `docs/adr/`. Most of it is gitignored because it holds
decisions, owner goals, and notes about users and costs.

| Path | Git | What it is |
|---|---|---|
| `README.md` | tracked | this file |
| `schema/*` | tracked | example shaped files that document the format |
| `ceo-context.md` | gitignored | owner notes the repo can't show: goals, audience, hours. Filled by `/director setup` |
| `decisions.md` | gitignored | append only decision log; agents raise entries, Dillon decides |
| `director-memos/` | gitignored | weekly director memos |
| `staff/<role>/` | gitignored | dated reports per employee |

Because these files are gitignored they have no version history and no remote copy. Copy the folder
somewhere safe now and then (a zip in cloud storage is enough). Never put a key, a token, or any
user's prayer in here, not even as an example.

Start with `/director setup`, then `/director review`.
