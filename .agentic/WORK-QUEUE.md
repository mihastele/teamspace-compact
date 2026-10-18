# Specification work queue

Updated 2026-10-18. PROJECT-STATE.md remains the append-only continuity record;
this queue identifies the next actionable tickets and keeps automated evidence
separate from browser/deployed acceptance.

| Ticket | Status | Next action / completion evidence |
| --- | --- | --- |
| R1 — Browse every local recovery archive | Implemented; browser acceptance open | Dated metadata pages, selected Markdown downloads, scope isolation, corruption recovery and unchanged active journals have real IndexedDB tests. Verify dialog focus/Escape, downloads, paging and linked-source recovery in browser. |
| R2 — Browser and two-user acceptance | Partially verified locally; authenticated acceptance open | [2026-10-17 browser evidence](BROWSER-ACCEPTANCE.md) covers table sorting/filter/columns/dialog focus, calendar keyboard/date-prefill/persistence and mobile navigation. Fixed mobile page overflow; current browser access works. Remaining: shared task moves, typing/IME, restore/recovery, conversations, fields, linked sources, exports and authenticated two-user/mobile flows. |
| R3 — Update configured self-hosted installation | Administrator action pending | Apply each unapplied migration through 016 after backup/review, deploy matching client/API, then verify Auth/Storage and two-user flows. Confirm expiry/staging cleanup scheduling. Do not hand-edit the database or infer deployment authorization. |
| R13 — Repeatable staging/production setup | Implemented; external/live acceptance open | `deploy:setup` generates private keys/env and isolated Compose/data roots; `deploy` validates/builds/backs up/migrates/publishes policy/starts web and hourly cleanup. Both images and isolation checks pass. Generated local staging/production files have blank external credentials and production placeholder URLs; no full stack was launched. Follow deploy/README.md for domains, SMTP, HTTPS, backup/restore and two-user acceptance. Legacy installation remains unchanged. |
| R4 — First remote CI evidence | Passed for 9784c4b; navigation-fix CI pending | [Run 37223851701](https://github.com/mihastele/teamspace-compact/actions/runs/37223851701) passed every verification step for application commit 9784c4bd58f50bacc591614e55ea9d1cfa72a191. Read via public GitHub API; gh was not needed. The 2026-10-17 navigation fix requires its own CI evidence. |
| R5 — Dependency release review | Review complete; remediation open | [Dependency review](DEPENDENCY-REVIEW.md) records fresh audits, advisory paths and upgrade constraints. Runtime: 2 moderate; full tree: 5 moderate/11 high. User decision pending on newer Node support for patched RE2; other fixes require reviewed major changes or upstream patches. No forced upgrades applied. |
| R6 — Repository license | User decision required | Select and add a license before public distribution, reconciling existing dependency/upstream notices. An agent must not silently select legal terms. |
| R7 — Complete workspace/account export and deletion | Scope/policy decision required | Define attachment/history/conversation export scope and ownership/retention rules before schema/auth/deletion work. Current per-note, board and conversation downloads are partial exports. |
| R8 — Older conversation messages | Deferred feature | Design bounded stable pagination on both backends, live-window reconciliation and deletion handling; current latest-50 UI remains documented. Notifications and block comments stay deferred. |
| R10 — Editable task pages and shared templates | Implemented/tested locally; live acceptance open | Explicit Save/revision conflict review, rich task blocks, task-local property management, shared template create/edit/apply/archive/restore and durable task draft/retry packets. Migration 015 and matching client/API required; authenticated live two-user acceptance remains open. See TASK-PAGES-PLAN.md and migrations/015-task-pages-templates.md. |
| R11 — Task duplication and repeatable development | Implemented/tested locally | Task actions duplicate editable content into an independent recovered draft; preserves original identity/comments/attachments and protects existing new-task drafts. `npm run dev:preview` starts browser-only mode on loopback:3107 without changing env files; `dev:connected` uses configured backend settings. README contains daily setup. Authenticated duplication acceptance and a persisted browser suite remain open. |
| R9 — Agentic projects/tickets and reusable views | M1a/M1b, M2/M3 and internal M4a/M4b implemented; acceptance open | [Implementation progress](AGENTIC-TICKETS-IMPLEMENTATION.md): shared services, durable Task mutations, canonical PostgreSQL Projects/ten normalized field types, indexed queries/shared layouts and note references. M4a adds bounded hosted/local transport and seven read/proposal tools; M4b adds private queue/audit storage, fenced leases/retries, revocation, quotas, cancellation, retention/export/workspace deletion. Migration 014 is prepared, not live-applied. Next: checkpoint engine/provenance resume, separate worker/process/Compose wiring and run UI, then M5 confirmed writes. Full ticket remains incomplete. |

MFA enrollment and public publishing remain outside
the current authorized implementation scope. PostgreSQL-focused agentic ticket
implementation and its recorded Project/agent-audit lifecycle policies are
approved in R9. No ticket here by itself changes a live installation's retention,
membership policy or a live installation by itself.

R12 — Independent databases and relations: user approved the alongside-Tasks/Projects
architecture on October 18. First PostgreSQL implementation adds named collections,
rich pages, typed properties, multi-entry relations and incoming links, safe saves,
archives and JSON export. See DATABASES-PLAN.md and migration 016. Live migration,
authenticated two-user/browser/mobile acceptance and a persisted React/browser suite
remain open. Formulas/rollups, Task/Project relation targets and database-specific
layouts/templates/comments/attachments are future increments. M4c is deferred while
this database work is prioritized.
