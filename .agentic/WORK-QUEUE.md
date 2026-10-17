# Specification work queue

Updated 2026-10-17. PROJECT-STATE.md remains the append-only continuity record;
this queue identifies the next actionable tickets and keeps automated evidence
separate from browser/deployed acceptance.

| Ticket | Status | Next action / completion evidence |
| --- | --- | --- |
| R1 — Browse every local recovery archive | Implemented; browser acceptance open | Dated metadata pages, selected Markdown downloads, scope isolation, corruption recovery and unchanged active journals have real IndexedDB tests. Verify dialog focus/Escape, downloads, paging and linked-source recovery in browser. |
| R2 — Browser and two-user acceptance | Partially verified locally; authenticated acceptance open | [2026-10-17 browser evidence](BROWSER-ACCEPTANCE.md) covers table sorting/filter/columns/dialog focus, calendar keyboard/date-prefill/persistence and mobile navigation. Fixed mobile page overflow; current browser access works. Remaining: shared task moves, typing/IME, restore/recovery, conversations, fields, linked sources, exports and authenticated two-user/mobile flows. |
| R3 — Update configured self-hosted installation | Administrator action pending | Apply unapplied migrations 009 and 012 after backup/review, deploy matching client/API, then verify Auth/Storage and two-user flows. Confirm expiry/staging cleanup scheduling. Do not hand-edit the database or infer deployment authorization. |
| R4 — First remote CI evidence | Passed for 9784c4b; navigation-fix CI pending | [Run 37223851701](https://github.com/mihastele/teamspace-compact/actions/runs/37223851701) passed every verification step for application commit 9784c4bd58f50bacc591614e55ea9d1cfa72a191. Read via public GitHub API; gh was not needed. The 2026-10-17 navigation fix requires its own CI evidence. |
| R5 — Dependency release review | Review complete; remediation open | [Dependency review](DEPENDENCY-REVIEW.md) records fresh audits, advisory paths and upgrade constraints. Runtime: 2 moderate; full tree: 5 moderate/11 high. User decision pending on newer Node support for patched RE2; other fixes require reviewed major changes or upstream patches. No forced upgrades applied. |
| R6 — Repository license | User decision required | Select and add a license before public distribution, reconciling existing dependency/upstream notices. An agent must not silently select legal terms. |
| R7 — Complete workspace/account export and deletion | Scope/policy decision required | Define attachment/history/conversation export scope and ownership/retention rules before schema/auth/deletion work. Current per-note, board and conversation downloads are partial exports. |
| R8 — Older conversation messages | Deferred feature | Design bounded stable pagination on both backends, live-window reconciliation and deletion handling; current latest-50 UI remains documented. Notifications and block comments stay deferred. |
| R9 — Agentic projects/tickets and reusable views | M1a/M1b and M2 implemented; acceptance open | [Implementation progress](AGENTIC-TICKETS-IMPLEMENTATION.md): shared services, repaired PUT and task detail GET, operation-bound retries/private receipts and reviewed revisions. User approved inherited Project access/reversible archive and configurable 30-day full agent audits. M2 adds canonical PostgreSQL Projects/ten normalized field types and archive policy. Next: indexed composable queries/saved views, worker and confirmed agent tools. Full ticket remains incomplete. |

MFA enrollment, independent databases and public publishing remain outside
the current authorized implementation scope. PostgreSQL-focused agentic ticket
implementation and its recorded Project/agent-audit lifecycle policies are
approved in R9. No ticket here by itself changes a live installation's retention,
membership policy or a live installation by itself.
