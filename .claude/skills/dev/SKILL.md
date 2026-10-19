---
name: dev
description: >
  Run the developer for FaithRequest. Modes: fix <what> (a bug), build <what> (a feature), adr
  <decision> (record a decision as an ADR), or any coding task. Works on a branch and commits;
  never pushes to master, merges, deploys, touches AWS, or uses the live table.
argument-hint: "[fix <what> | build <what> | adr <decision> | <task>]"
disable-model-invocation: true
context: fork
agent: developer
---

## Developer run

Arguments: `$ARGUMENTS`

Read `docs/staff-handbook.md`, `CLAUDE.md`, and `docs/adr/README.md` first. Pick the mode from the
first word. Anything else is the task itself.

**Before any edit:** check `git status`. If you're on `master`, create a branch for the job first.
If the working tree has uncommitted changes that aren't yours, stop and say so.

### fix <what>
Reproduce it against a local emulator with made up data, ideally as a test. Fix the smallest thing
and check nothing else moved.

### build <what>
Find the closest existing page, component, or route and follow its pattern. Render user text with
`textContent`, never log prayer content, and check both themes and a narrow viewport. Add tests
where a suite exists.

### adr <decision>
Write the next numbered ADR in `docs/adr/` in the existing format and add its row to the index. If
it supersedes an older one, mark that row.

**Every mode ends the same way:** verification run and reported honestly (including what you
couldn't run), a commit on the branch, and a note in `ops/staff/dev/` with the branch, what
changed, results, rough hours, and anything Dillon has to do (push, deploy commands from `/ops`,
a `CLAUDE.md` Changelog entry if infrastructure changed). Never push to `master`.
