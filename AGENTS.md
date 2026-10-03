# Agents.md

This file tells any AI coding agent working in this repo how to operate.
The product principles below are not aspirations; they are constraints on
every piece of code written in this repo. Read `MISSION.md` (or equivalent)
if you need the full reasoning behind them.

Project name: `<TBD>`

## Session continuity

This project spans many sessions. `.agentic/PROJECT-STATE.md` is the record of what
has already been done.

### At the start of every session

1. Read `.agentic/PROJECT-STATE.md` in full.
2. Tell the user which milestone and task they left off on, and anything
   marked BLOCKED or NEEDS DECISION.

### After completing any task

Append a log entry to `.agentic/PROJECT-STATE.md`. Update the Current Facts table if
a value changed. Never rewrite or delete prior log entries.

A task counts as "done" only when all of the following are true:

- The relevant tests pass (or, if no tests exist yet for this area, that
  gap is explicitly logged as an open item — not silently skipped).
- No TODOs or shortcuts were left in the code without a corresponding
  line in the log or Open Decisions section.
- The log entry has been appended.
- If the task deviated from "boring, well-understood technology" (see
  Working style), the reason for the deviation is recorded in the log.

### When something breaks mid-task

- Prefer small, frequent commits over one large commit at the end, so a
  bad change can be isolated and reverted without losing unrelated work.
- Never force-push or rewrite shared/pushed history to "clean up" a
  mistake. If history needs correcting, propose it to the user first.
- If a task fails partway: don't leave the repo in a half-migrated or
  non-building state across a session boundary. Either finish, fully
  revert, or clearly mark the broken state as BLOCKED with exact
  repro steps in the log — never leave it ambiguous which it is.
- Log failures with the same care as successes. Use a `### FAILED` or
  `### BLOCKED` sub-entry so future sessions (and the user) can grep for
  what went wrong and why, separately from the routine progress log.

### When a task is ambiguous

- If a task can reasonably be implemented two materially different ways
  (different schema shape, different library, different UX flow), stop
  and ask rather than silently picking one and logging the assumption
  afterward. Logging an assumption is for minor, low-stakes judgment
  calls only — not for decisions that would be expensive to undo.

### Never write to .agentic/PROJECT-STATE.md (or anywhere in the repo)

Private keys, `.pem` / `.key` contents, passwords, API tokens, cloud access
keys, database connection strings with credentials, payment-provider secret
keys, SMTP passwords. Record *locations* only, e.g.
`signing key at ~/.ssh/deploy.pem`, `secrets in .env (gitignored)`.

If you notice a secret has been committed, stop and tell the user before
doing anything else. Do not try to "fix" git history on your own.

### Example .agentic/PROJECT-STATE.md

```markdown
# Project State

## Current Facts

| Item                  | Value                          | Set on     |
| --------------------- | ------------------------------ | ---------- |
| Repo                  | github.com/<user>/<project>    | <date>     |
| License               | <TBD>                          |            |
| Backend               | <TBD>                          |            |
| Frontend              | <TBD>                          |            |
| Database              | <TBD>                          |            |
| Object storage        | <TBD>                          |            |
| Dev server URL        | http://localhost:3000          |            |
| Secrets location      | .env (gitignored), never repo  | <date>     |

## Open decisions

- <decision 1>
- <decision 2>

## Log

### <date> — Milestone 0: setup

- Wrote MISSION.md and agents.md
- Chose <license> because <reason>
- STOPPED — next: <next step>

### <date> — Milestone 2: uploads

- FAILED — S3 migration script errored on existing rows with null
  `owner_id`. Reverted migration. Repro: run `migrate up` on staging
  snapshot from <date>. BLOCKED on decision: backfill vs. reject nulls.
```

# Product principles (hard constraints)

These are the reasons the project exists. Replace this section with the
actual principles for this project — 5-10 concrete, testable constraints,
not vague values. Each one should be specific enough that a piece of code
can obviously violate it. If a request conflicts with one of them, say so
before implementing, and propose an alternative that fits.

Example shape for a principle:

## <N>. <Principle name>

- <Concrete rule this implies for the code>
- <Concrete rule this implies for the UI/UX>
- <What to flag or refuse if a ticket asks for it anyway>

# Engineering rules

## Database

- Every schema change is a migration file in the migrations directory.
  Never change a live database by hand.
- After any schema change: regenerate types, run migrations from scratch
  on a clean database to confirm they apply, and explain the change in
  plain language before moving on.
- Access control (row-level or equivalent) on every table that holds user
  or sensitive content. After a schema change, confirm it is enabled on
  every affected table and report the result.
- Every table with user data needs a clear answer to "how does this get
  exported?" and "how does this get deleted?" before it's merged — if the
  project has data-export/deletion requirements.

## Security

- Validate and authorize on the server. Client-side checks are UX only.
- Rate-limit anything that can be abused (login, signup, posting, messaging,
  invites). Use the minimum identifying data needed to do so.

## Dependencies

- Prefer fewer, well-maintained, appropriately licensed packages over
  writing custom code, and prefer well-known code over exotic packages.
- Pin exact versions (lockfile committed). Don't use loose ranges (`^`,
  `~`) for anything that touches auth, payments, or data integrity.
- Before adding a new dependency: check its license is compatible with
  the project's license, check it's actively maintained (commits/issues
  in the last ~12 months as a rough bar), and say in the log why it was
  chosen over the alternatives considered.
- Major version bumps of existing dependencies are proposed, not applied
  silently — read the changelog for breaking changes first.

## Testing

- Once the test suite exists, run it after every major change and before
  declaring any task done.
- Every product principle above should eventually have at least one test
  that would fail if it were violated.

## Working style

- State the user's experience level and preferences here (e.g. "explain
  reasoning, don't over-explain basics" vs. "explain everything").
- Propose before you build when a change touches auth, payments, data
  retention, or anything in the product principles.
- Prefer boring, well-understood technology unless there's a specific
  reason not to — and if you deviate, say why in the log (see "task is
  done" criteria above).
- Keep the README current. If a step in setup changed, the README changes
  in the same commit.

---

# Appendix: conditional sections

Only include the sections below if they apply to this project. Delete
whichever don't, rather than leaving them as unused boilerplate — an
AGENTS.md full of inapplicable rules is easy to start ignoring wholesale.

## Storage / media (if the project handles file uploads)

- Uploaded files are stored behind an interface, never directly on the
  app server's disk in production.
- Strip metadata that shouldn't be retained (e.g. EXIF/GPS from images) on
  upload by default, if privacy is a project principle.
- Enforce any storage/usage quotas at write time, server-side.

## Compliance / regulated data (if the project handles health, financial,
## or other regulated data)

- Name the applicable regime(s) here (e.g. GDPR, HIPAA, PCI-DSS) and the
  concrete obligations that follow — retention limits, audit logging,
  encryption at rest, breach notification timelines. Don't leave this
  generic; a testable rule per obligation, same as the product principles.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
