# Specification work queue

Updated 2026-10-04. PROJECT-STATE.md remains the append-only continuity record;
this queue identifies the next actionable tickets and keeps automated evidence
separate from browser/deployed acceptance.

| Ticket | Status | Next action / completion evidence |
| --- | --- | --- |
| R1 — Browse every local recovery archive | Implemented; browser acceptance open | Dated metadata pages, selected Markdown downloads, scope isolation, corruption recovery and unchanged active journals have real IndexedDB tests. Verify dialog focus/Escape, downloads, paging and linked-source recovery in browser. |
| R2 — Browser and two-user acceptance | Open; previous browser-tool security restriction recorded | Run SPEC.md checks for shared task moves, typing/IME, restore/recovery, conversations, fields, linked sources, table and mobile. Retain exact results and screenshots; pure/database tests do not close this ticket. |
| R3 — Update configured self-hosted installation | Administrator action pending | Apply tracked migration 009 after backup/review, deploy matching client/API, then verify Auth/Storage and two-user flows. Confirm expiry/staging cleanup scheduling. Do not hand-edit the database or infer deployment authorization. |
| R4 — First remote CI evidence | Passed for current application | [Run 37223851701](https://github.com/mihastele/teamspace-compact/actions/runs/37223851701) passed every verification step for application commit 9784c4bd58f50bacc591614e55ea9d1cfa72a191. Read via public GitHub API; gh was not needed. Later application changes still require their own CI evidence. |
| R5 — Dependency release review | Review complete; remediation open | [Dependency review](DEPENDENCY-REVIEW.md) records fresh audits, advisory paths and upgrade constraints. Runtime: 2 moderate; full tree: 5 moderate/11 high. User decision pending on newer Node support for patched RE2; other fixes require reviewed major changes or upstream patches. No forced upgrades applied. |
| R6 — Repository license | User decision required | Select and add a license before public distribution, reconciling existing dependency/upstream notices. An agent must not silently select legal terms. |
| R7 — Complete workspace/account export and deletion | Scope/policy decision required | Define attachment/history/conversation export scope and ownership/retention rules before schema/auth/deletion work. Current per-note, board and conversation downloads are partial exports. |
| R8 — Older conversation messages | Deferred feature | Design bounded stable pagination on both backends, live-window reconciliation and deletion handling; current latest-50 UI remains documented. Notifications and block comments stay deferred. |

MFA enrollment, independent databases, AI and public publishing remain outside
the current authorized implementation scope. No ticket here changes retention,
membership policy or a live installation by itself.
