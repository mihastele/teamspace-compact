# Specification work queue

Updated 2026-10-21. PROJECT-STATE.md remains the append-only continuity record;
this queue identifies the next actionable tickets and keeps automated evidence
separate from browser/deployed acceptance.

| Ticket | Status | Next action / completion evidence |
| --- | --- | --- |
| R1 — Browse every local recovery archive | Component browser acceptance passed; full-app acceptance open | Real browser IndexedDB/Strict Mode fixture verifies focus/Escape, paging across another tab's archive, refreshed/Unicode Markdown downloads, corrupt-record recovery, page/source/account/workspace isolation, unchanged active journal and 390px layout. Repeat with `npm run test:ui:recovery-archives`. Full-app authenticated linked-source placement and delayed-read close/navigation remain open; no automated DOM suite. |
| R2 — Browser and two-user acceptance | Partially verified locally; authenticated acceptance open | [2026-10-17 browser evidence](BROWSER-ACCEPTANCE.md) covers table sorting/filter/columns/dialog focus, calendar keyboard/date-prefill/persistence and mobile navigation. Fixed mobile page overflow; current browser access works. Remaining: shared task moves, typing/IME, restore/recovery, conversations, fields, linked sources, exports and authenticated two-user/mobile flows. |
| R3 — Update configured self-hosted installation | Administrator action pending | Apply each unapplied migration through 016 after backup/review, deploy matching client/API, then verify Auth/Storage and two-user flows. Confirm expiry/staging cleanup scheduling. Do not hand-edit the database or infer deployment authorization. |
| R13 — Repeatable staging/production setup | Implemented; external/live acceptance open | `deploy:setup` generates private keys/env and isolated Compose/data roots; `deploy` validates/builds/backs up/migrates/publishes policy/starts web and hourly cleanup. Both images and isolation checks pass. Staging now runs with local Mailpit capture: full up, backup, migrations through 016, HTTP 200, confirmation-link delivery/verification and first scheduled cleanup pass. Production retains blank external credentials and placeholder URLs; production launch, external SMTP/HTTPS, restore and authenticated two-user acceptance remain open. Follow deploy/README.md for domains, SMTP, HTTPS, backup/restore and two-user acceptance. Legacy installation remains unchanged. |
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
remain open. October 21 adds local typed column sorting over loaded rows, with
nulls last and stable ID ties; header/reset/paging/refresh/mobile browser
acceptance for sorting remains open. Searchable relation pickers now retain
selected/unavailable links, allow explicit clearing and target-read retry, and
enforce the existing cap/archive controls in the UI. Manual component checks
pass via `npm run test:ui:database-relations`; full authenticated editor/save
acceptance remains open. Task/project relation targets and automatic removal of links on task deletion are implemented with migration 018. Migration 019 adds separate task/project properties that select entries in a chosen data source, saved with the page; migration 020 adds task/project backlinks and direct entry navigation. Shared task/project relation definitions can be renamed with revision checks. Authenticated, two-user and deployed acceptance remain open. Formulas/rollups and database-specific saved layouts/templates/comments/attachments are future increments. M4c is deferred while
this database work is prioritized.


R14 — Named boards directly in notes: create/link named boards from a note,
configure existing ticket-property/Project relation filters, and edit shared
filter/presentation settings in embeds. User selected shared tickets and existing
Project/property filtering on October 19. Implemented with existing saved-view
APIs; no schema migration. See NOTE-BOARDS-PLAN.md. Cancellation/repeated Escape,
focus and mobile checks now pass in a maintained manual component fixture
(`npm run test:ui:named-boards`). Authenticated two-user/deployed acceptance and an
automated DOM suite remain open.
New relation targets, related-record property traversal, database layouts and
rollups remain later increments.
