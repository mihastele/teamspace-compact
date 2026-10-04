# Specification work queue

Updated 2026-10-04. PROJECT-STATE.md remains the append-only continuity record;
this queue identifies the next actionable tickets and keeps automated evidence
separate from browser/deployed acceptance.

| Ticket | Status | Next action / completion evidence |
| --- | --- | --- |
| R1 — Browse every local recovery archive | Implemented; browser acceptance open | Dated metadata pages, selected Markdown downloads, scope isolation, corruption recovery and unchanged active journals have real IndexedDB tests. Verify dialog focus/Escape, downloads, paging and linked-source recovery in browser. |
| R2 — Browser and two-user acceptance | Open; previous browser-tool security restriction recorded | Run SPEC.md checks for shared task moves, typing/IME, restore/recovery, conversations, fields, linked sources, table and mobile. Retain exact results and screenshots; pure/database tests do not close this ticket. |
| R3 — Update configured self-hosted installation | Administrator action pending | Apply tracked migration 009 after backup/review, deploy matching client/API, then verify Auth/Storage and two-user flows. Confirm expiry/staging cleanup scheduling. Do not hand-edit the database or infer deployment authorization. |
| R4 — First remote CI evidence | Unverified | Read the current branch workflow status and failures, correct reproducible failures, and record the run URL/commit. Local passing tests do not prove CI passed; gh is unavailable on the current host. |
| R5 — Dependency release review | Open | Refresh npm audit, review primary advisories/reachability and compatible patch fixes. Keep exact security/data-integrity versions; propose major bumps rather than applying them silently. Earlier audit counts in PROJECT-STATE.md are historical evidence. |
| R6 — Repository license | User decision required | Select and add a license before public distribution, reconciling existing dependency/upstream notices. An agent must not silently select legal terms. |
| R7 — Complete workspace/account export and deletion | Scope/policy decision required | Define attachment/history/conversation export scope and ownership/retention rules before schema/auth/deletion work. Current per-note, board and conversation downloads are partial exports. |
| R8 — Older conversation messages | Deferred feature | Design bounded stable pagination on both backends, live-window reconciliation and deletion handling; current latest-50 UI remains documented. Notifications and block comments stay deferred. |

MFA enrollment, independent databases, AI and public publishing remain outside
the current authorized implementation scope. No ticket here changes retention,
membership policy or a live installation by itself.
