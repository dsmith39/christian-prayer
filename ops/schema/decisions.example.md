# Decisions

Append only. One `##` entry per decision, newest at the bottom. An agent adds an entry with
`**Status:** open` when it recommends something; Dillon's call changes it to `decided` or
`declined`. `scripts/director/snapshot.mjs` lists every open entry. Gitignored: copy to
`ops/decisions.md`.

**Every value below is a placeholder showing the format.**

## Turn on point in time recovery for the users table

**Status:** open
**Raised by:** ops · **Raised:** 2026-10-19
**Recommendation:** turn it on.
**Why:** one table holds everyone's prayers, and a bad write or delete is otherwise unrecoverable.
**Cost of deciding wrong:** a few cents a month if unneeded; permanent loss if needed and missing.
**Would change my mind:** the table is already protected some other way.

## Example of a closed entry

**Status:** decided
**Raised by:** dev · **Raised:** 2026-10-01 · **Decided:** 2026-10-03
**Decision:** keep Express 4 and serverless-http 3 until a tested branch moves both together.
**Follow through:** `/qa tests` lands first, then `/dev` tries the paired bump on a branch.
