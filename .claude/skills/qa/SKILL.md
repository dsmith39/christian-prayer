---
name: qa
description: >
  Run QA for FaithRequest. Modes: tests (build the missing test suite on a branch, starting with
  the highest risk paths), review (check the working branch before a PR, the default), privacy
  (trace where prayer text goes and report leaks), a11y (accessibility and both themes),
  reminders (what actually fires and when). Never merges or deploys.
argument-hint: "[tests | review | privacy | a11y | reminders | <question>]"
disable-model-invocation: true
context: fork
agent: qa
---

## QA run

Arguments: `$ARGUMENTS`

Work from the repo root. Pick the mode from the first word. No arguments means **review**.
Anything else is a question: answer it as the QA lead.

**Every mode starts the same way:** read `docs/staff-handbook.md`, `CLAUDE.md`, and the ADR index,
then run `node scripts/director/snapshot.mjs`.

### tests
Build the first slice of the suite on a branch with the Node test runner, Supertest, and a local
DynamoDB emulator with made up users: register and login, the email lock, token handling, rate
limits, list and prayer CRUD, answered status, and delete account removing the user and the email
lock. Show each test failing without the behavior it guards. Never use the live table.

### review
Diff the branch against `master`. Check validation, auth on every non public route, that one user
can never touch another's data, that nothing logs or returns prayer text where it shouldn't, and
that user text is rendered with `textContent`. Run whatever tests exist. Report pass or fail per
item, and a clear "ready for PR" or "not yet."

### privacy
Trace where prayer text goes: request bodies, logs, error responses, `localStorage`,
notifications, any analytics. Report each place it leaves the owner's own session, with severity
and the smallest fix.

### a11y
Keyboard use, focus, labels, contrast in both themes, and a narrow viewport, on each page as built.

### reminders
What fires and when with the tab open, closed, and permission denied (ADR-0008). Report the gap
between what a user would expect and what happens.

**Every mode ends the same way:** a report in `ops/staff/qa/<YYYY-MM-DD>-<topic>.md` in the
handbook format, and your reply ends with the bottom line and the path.
