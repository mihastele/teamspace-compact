# Project State

## Current Facts

| Item | Value | Set on |
| --- | --- | --- |
| Project | Teamspace | 2026-10-03 |
| Frontend | Next.js 16 / React 19 / TypeScript / plain CSS | 2026-10-03 |
| Backend | Firebase Admin trusted route handlers | 2026-10-03 |
| Database | Cloud Firestore | 2026-10-03 |
| Object storage | Private Firebase Storage | 2026-10-03 |
| Hosting target | Vercel | 2026-10-03 |
| License | Not yet selected | 2026-10-03 |
| Git workflow | User authorized committing completed changes and pushing the current branch to origin; no force pushes | 2026-10-04 |
| Authentication policy | Google OAuth via Firebase; 2FA optional by default, enrollment/challenge UI not yet implemented | 2026-10-04 |
| Secrets location | Server environment only; local .env.local gitignored | 2026-10-03 |
| Current milestone | Milestones 1–5 plus bounded Yjs collaboration, durable recovery and approximate presence implemented/tested; collaboration browser acceptance open; Milestone 6 live release blocked | 2026-10-03 |

## Open decisions and release gates

- NEEDS DECISION (page history): automatic five-minute checkpoints with 30-day expiry plus permanent named versions, versus retaining every committed edit indefinitely. Also choose title/content-only restore versus including page location. Native questions opened; no answer received yet.

- NEEDS DECISION: repository license before public distribution. Firebase SDK dependencies are Apache-2.0; emulator CLI is MIT.
- BLOCKED: no Firebase project configuration provided. Live authentication, deployment, signed uploads, and two-user acceptance need project provisioning.
- PASSED: 91 unit/model/controller/IndexedDB/editor-helper/task cases plus 9 authorization rules suites and 33 trusted Firestore API cases (133 total) pass; final lint/typecheck/build pass. Rich editor/embedded-board browser interaction checks remain OPEN; earlier desktop/mobile checks covered the previous interface.
- Confirm deployed authorized domains, Storage CORS and billing, then complete two-user acceptance from SPEC.md.
- RELEASE REVIEW: runtime npm audit reports 2 moderate findings (gaxios/uuid); full dependency tree reports 16 findings (5 moderate, 11 high), with high findings confined to development tooling. No forced major upgrades were applied. gaxios uses uuid.v4(), whereas the reported uuid advisory concerns buffer handling in v3/v5/v6; this limits observed exposure but is not a blanket security clearance.
- OPEN TEST GAP: no persisted automated browser suite; desktop/mobile/manual browser checks cover local mode only. Real Google ID-token verification, deployed signed URL/CORS behavior and two-user UI acceptance remain external checks. Attachment API tests use an in-memory bucket with real Firestore transactions and real image decoding, not live GCS.
- OPEN: choose repository license, review dependency findings, and observe the first remote CI run. Use Node 22.13+ or 24; the current host Node 22.12 passed checks but emits engine warnings.

## Log

### 2026-10-03 — Milestone 0: session recovery

- Read SPEC.md and referenced chat “Plan a hackathon night”. Previous session stopped after starter/spec creation; user had no Firebase project.
- PROJECT-STATE.md did not exist; initialized continuity record without changing prior history.
- Proposed implementation matching the agreed auth/access/storage spec. User authorized building the application and parallel agents.
- Chose official Firebase SDKs over custom auth/database integrations; exact versions checked against npm registry and recent maintenance confirmed. Existing license is undecided, recorded above.
- STOPPED checkpoint: building UI, trusted backend, client integration and authorization tests concurrently; no live database modified.

### 2026-10-03 — Milestones 1–5: trusted collaboration implementation

- Implemented Firebase Google sign-in integration, workspace create/join, membership index, random hashed transactional invitations, owner transfer/removal and member leave protection.
- Added trusted server API with ID-token validation, per-user distributed limits, strict input/immutable-field validation, transaction membership checks and revision-checked note saves.
- Added private two-phase attachment uploads with signed exact byte limits and create-only staging generation. Validates file format/decoded images, promotes into private paths, generates transparent <=400px thumbnails, and cleans original/staging/thumbnail files on deletion. Failed deletions remain retryable. Pending metadata uses 24-hour TTL; ready data has no automatic expiry.
- Client compression preserves aspect ratio/orientation/transparency, caps photos at 2048px without upscaling, preserves PNG screenshot text, and offers Keep original. No binary content stored in Firestore.
- Added default-deny member-read/client-write-denial rules for every affected user-content collection; Storage denies direct SDK operations. Baseline numbered migration, indexes, TTL and export/deletion policy documented; clean emulator fixtures verified schema/access from scratch. Firestore has no generated-schema types, so maintained TypeScript document models with server validators.
- Dependencies pinned: Firebase 12.19.0 and Admin 14.5.0 (official SDKs over custom integrations), sharp 0.35.5 (same version already used by Next, bounded image decoder over custom binary processing), rules testing 5.0.2 and Firebase CLI 15.32.1 (official emulators over mock rule parsing). Apache-2.0/MIT licenses and recent maintenance checked; project licensing remains open. Added compatible grpc-js 1.14.5 override to resolve its high advisory without major upgrades.
- PASSED: 9 validation cases + 7 rule suites + 12 trusted-API cases, including outsider denial, concurrent note/invite transactions, owner operations, rate limits, exact upload bounds, private thumbnail transparency and corrupt image rejection. API bucket operations mocked; Firestore transactions and image decoding real.
- No exotic technology deviation, code TODOs, private credentials, live migrations or deployment. Setup instructions updated alongside implementation.

### FAILED — 2026-10-03: verification issues resolved

- Windows Java 21 emulator startup initially failed with AF_UNIX Invalid argument/loopback connection error. Repro: standard emulator launch on this Corretto installation. Process-only nonexistent jdk.net.unixdomain.tmpdir forced TCP fallback; all suites then passed. Workaround documented without changing machine settings.
- Initial trusted dispatcher returned mutation promises without awaiting inside its error boundary. Integration failures exposed uncaught authorization errors; awaited dispatch fixed the boundary and all expected HTTP statuses passed.
- First integrated lint found hydration-state effects and generated CommonJS output being linted. Moved external hydration into callbacks, corrected render-time ref use, excluded generated build output, and scoped CommonJS test imports. Lint now passes.

### 2026-10-03 — Milestone 5: interface and release preparation

- Replaced starter with responsive navy/cobalt workspace, board/task dialogs, explicit note save states and safe formatted previews, member/invite controls, and attachment flows. Added search/keyboard shortcut, drag plus accessible status selector, empty/loading/error states, reduced motion and visible focus.
- Notes preserve drafts across navigation/workspaces, warn before reload/signout loss, detect newer/deleted remote revisions and offer copy/reload. Fixed doubled invitation URLs, new-note selection after save, task audit-field round trips and joined-workspace selection.
- PASSED browser checks: local task creation/status selection, refresh persistence, note save/unsafe-link plain-text rendering, navigation preserving unsaved draft, 390px viewport with no horizontal overflow, dialog sizing/title focus/Escape focus restoration. Screenshot saved locally at .agentic/verification/board.jpg (gitignored). Automated browser suite gap remains above.
- PASSED lint, typecheck and optimized production build. Added least-privilege, SHA-pinned GitHub CI repeating checks with isolated emulators; remote workflow execution remains unverified until pushed.
- BLOCKED release: no Firebase project/service credentials or Vercel deployment supplied. Do not call the local preview shared/authenticated or claim production readiness. Next: provision Firebase, set environment locally/Vercel, deploy rules/indexes/TTL, configure bucket CORS/staging lifecycle and authorized auth domains, then complete deployed two-user acceptance and dependency review.


### 2026-10-03 — Nested notes and shared workspace extension

- User requested Notion-style root notes, subnotes and deeper descendants, with multiple workspace users collaborating on notes and Kanban. Extended the existing member-authorized, live saved-update model; explicit Save and revision conflict protection remain. Simultaneous typing is not implemented and would require a separate editor/data-model decision.
- Added expandable alphabetical note hierarchy, root/subnote creation, ancestor breadcrumbs, search retaining ancestor context, and parent moves committed together with content on Save. Moving a note carries its subtree without rewriting descendants. No application nesting depth cap.
- Preserved separate drafts for new roots/subnotes and existing notes across navigation; clean drafts follow remote saved revisions, while dirty/conflicting/deleted-note drafts remain recoverable. All levels inherit workspace membership.
- Added migration 002: nullable parentId on notes, legacy missing values interpreted as roots, and workspace noteTreeRevision to serialize structural mutations. Updated maintained TypeScript models; no generated Firestore schema types exist. No live database changed or destructive backfill required. Export/deletion policy documented and README/SPEC updated.
- Server validates same-workspace live parents and complete ancestry inside transactions. Rejects self/descendant/corrupt cycles; concurrent reciprocal moves cannot form cycles. Parent deletion refuses children before modifying flags or attachments; create/move/delete races cannot orphan children.
- Access control verified on every affected collection: member-only note/workspace reads, browser writes denied, trusted mutations reauthorize membership transactionally; Storage remains default-deny. Clean emulator fixtures verify additive schema and legacy behavior from scratch.
- PASSED: 19 validation/tree tests, 8 authorization/Storage rule suites, 20 trusted API cases (47 total), lint, typecheck and optimized production build. Covers member shared saves, outsider denial, cycle rejection, concurrent structural races, stale saves, and child-preserving deletion with attachment bytes untouched.
- PASSED manual browser checks: root/child/grandchild creation, persisted hierarchy after refresh, breadcrumbs, search with ancestors, parent move with subtree retention, blocked parent deletion, descendant-free parent choices, navigation preserving unsaved content, and 390px/1280px layouts without horizontal overflow. Screenshot at .agentic/verification/nested-notes.jpg (gitignored). Existing automated-browser and deployed two-user verification gaps remain open above.
- No new dependency, exotic technology deviation, code TODO, credential, live migration or deployment. Release remains BLOCKED on Firebase provisioning; license and dependency review remain open.

### FAILED — 2026-10-03: rate-limit verification stabilized

- First combined emulator run passed hierarchy/authorization cases but an existing invitation rate-limit test crossed the real minute boundary and unexpectedly received a legitimate new-window allowance. Scoped the test clock to a fixed window and explicitly tested allowance after advancing one minute. Reran the entire clean emulator suite successfully; application rate-limit behavior unchanged.


### 2026-10-03 — Discoverable subnotes and inline block editing

- User reported subnote creation could not be found and requested Notion-style right-click actions plus instant block formatting. Consulted official Notion writing/editing and subpage guidance. Kept the existing paragraph/heading/bullet schema and explicit-save model; no costly library/schema decision required.
- Every saved tree row now has visible Add subnote (+) and ellipsis actions, a right-click menu, and keyboard context-menu support. The note body also lists clickable child pages with Add subnote. Unsaved parents explain that saving is required first. New/reopened drafts receive title focus; menu Escape restores its trigger; menus stay workspace-scoped.
- Replaced Markdown textarea/separate preview with directly styled inline blocks. Slash and + menus offer text, headings, bullets and subnotes; Enter splits/continues blocks, Shift+Enter inserts a line, Backspace merges, multiline paste creates blocks, and controls convert/reorder/remove. Headings/lists render while editing; safe bold/http(s) links display when unfocused. Preserved plain source editing and existing server validation limits, with no HTML injection.
- Drafts store NoteContent directly instead of serializing through Markdown; existing paragraph text beginning with Markdown-like prefixes cannot silently change type on save. Existing saved block types, permissions, revisions and attachments retained. README/SPEC updated; no migration, new dependency, exotic technology deviation or code TODO.
- Review fixed title/menu focus, destination ancestor expansion after save, and malformed cyclic recovery rows being hidden by expansion filters. Added shared traversal visibility helper and three regression cases.
- PASSED: 22 unit/validation/tree tests + 8 rules suites + 20 trusted API cases (50 total), lint, typecheck and final optimized production build. Preview server restarted on localhost:3000; HTTP smoke response 200.
- OPEN TEST GAP: this session could not verify new context-menu keyboard focus, inline typing/paste, mobile layout or structured block save/reload in browser. Browser tool automatically rejected selecting localhost with a URL-security policy error (despite http being listed as allowed); respected the rejection without alternate UI surfaces or workarounds. Previous screenshots/checks predate this editor and are not evidence for it. No persisted automated editor/browser suite yet; these checks remain open alongside deployed two-user acceptance.
- Release remains BLOCKED on Firebase provisioning; license/dependency release review unchanged. No secret or live data mutation performed.

### FAILED — 2026-10-03: preview launch argument forwarding resolved

- PowerShell/npm forwarded `npm run dev -- --port 3000` as `next dev 3000`, treating the port as a directory. Launched the installed Next executable directly with the port option; server became ready and HTTP smoke check passed. No application build failure or machine setting change.


### 2026-10-03 — Markdown shortcuts and embedded shared board

- User requested hash-plus-space heading conversion, distinct H2 and broader Markdown support, Kanban inside notes, and lower agent usage. Worked with one agent and no delegation. Explained account-wide usage snapshot and official usage factors without inventing per-chat token attribution or claiming a pricing/model change.
- Asked the data-model decision required by AGENTS.md; user explicitly chose embedding the existing workspace board over independent boards. Extracted one reusable WorkspaceBoard component for Board view and note blocks; cards, drag status changes, creation and task dialogs use the same live task data/trusted APIs. Removing a block/note leaves tasks intact.
- Added exact typed shortcuts for H1–H6, bullets, ordered lists, task lists, quotes, code fences and dividers. Heading levels and task checked state persist directly; legacy heading blocks default to H1. Added slash commands/type controls and scrollable keyboard menu. Multiline Markdown paste retains source in a live rendered Markdown block.
- Added CommonMark/GFM renderer for emphasis, strikethrough, inline/fenced code, lists, task lists, images, links, tables and footnotes. Raw HTML is not interpreted; unsafe URL protocols are rejected, safe external links isolate their opener, invalid image URLs render alt text. Structured headings/lists edit directly; complex Markdown retains editable source plus live preview.
- Migration 003 documents additive block types and optional level/checked fields, compatible legacy reads, export/deletion and deploy/rollback expectations. Updated maintained TypeScript models and strict server field/type validation. No new table/index/rule, no live DB mutation or backfill. Clean emulator schemas/authorization verified: workspace/member/note/task/attachment access remains member-read/server-write, Storage default-deny. Embedded boards cannot name a foreign workspace.
- Added exact dependencies react-markdown 10.1.0 and remark-gfm 4.0.1, both MIT, over extending ad-hoc regular expressions or enabling raw HTML. Registry license/version and upstream activity checked: react-markdown commit 2026-10-03; stable remark-gfm latest commit/release 2025-02-10 with issues updated 2026-04-23. Project license remains undecided; permissive dependency licenses recorded for its eventual license review. Lockfile updated; no major upgrade to existing dependencies. Runtime audit remains 2 moderate/0 high findings; full install audit remains 16 (unchanged release gate).
- PASSED: 28 unit/tree/validation/actual-renderer cases, 8 rules suites, 21 trusted API cases (57 total), final lint/typecheck/optimized build and preview HTTP 200. New tests verify heading persistence, shortcut semantics, schema/legacy compatibility, real GFM rendering, unsafe HTML/URL handling, rich-block trusted persistence, outsider denial and preservation of tasks when removing an embed.
- OPEN TEST GAP: live typing/caret/checkbox/drag/menu layout and embedded task dialog interactions are not browser-verified; previous browser policy rejection remains an unresolved verification limitation. Server rendering/security tests are not a substitute for that acceptance. Firebase provisioning, live two-user deployment, license, dependency review and browser automation remain open. No screenshot claimed for this new interface.

### FAILED — 2026-10-03: verification output and cleanup rejection

- Importing maintained note types expanded the compiler's inferred root, which could leave old test entry paths pointing at stale generated output. Fixed explicit server compilation root and test imports; all suites now read the freshly emitted server files. Added actual renderer/security tests.
- Automatic approval review rejected a proposed generated .test-build cleanup command as "blocked by policy". Did not delete or use alternate deletion methods; corrected compiler paths instead. Repository source/build remains valid and no partial migration remains.


### 2026-10-03 — Small increment: recoverable block edits

- User asked for a small/medium spec increment with limited remaining account usage. Added one focused editor improvement with no subagents, dependency, schema change, migration or backend changes.
- Undo/Redo buttons and scoped Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y restore content, block type/metadata, deletion and ordering. Same-block typing within 750ms coalesces; structural actions create distinct checkpoints. Twenty checkpoints bound memory; new edits after undo discard redo.
- History belongs to the mounted open note; different note/workspace keys remount it, and external content replacement permanently clears history. Undo remains an unsaved draft operation subject to existing Save/revision checks, disables during Save, and does not change title/location or reverse shared Kanban task mutations. Keyboard capture excludes the embedded board; restores focus to an editable block when available.
- Updated SPEC and README. No TODO, exotic technology deviation, secret, live data change or new release gate.
- PASSED: 34 unit/tree/validation/renderer/history cases, including six new regressions for metadata recovery, typing grouping/pauses, separate blocks, redo branching, bounded history and external replacement. Final lint and optimized build (including TypeScript) pass. Unchanged 8 rule + 21 trusted API cases passed in the previous increment; skipped their rerun because no server/schema/access code changed.
- OPEN TEST GAP: keyboard/caret and toolbar interactions remain unverified in browser, alongside earlier rich-editor/mobile/embedded-board acceptance. Prior browser policy restriction remains recorded; no new browser check or screenshot claimed. Firebase provisioning/license/dependency/deployed two-user gates unchanged.


### 2026-10-03 — Small increment: Download Markdown

- Added note toolbar Download Markdown for the current title/content, including unsaved or conflicting drafts. Export does not save, alter dirty state or mutate workspace data.
- Preserves heading levels, checklist states, Unicode, multiline quotes/code and Markdown. Portable .md filename strips forbidden path/device-name hazards; title is a single escaped heading. Board embeds are textual references; tasks/attachments/subnotes are not bundled. UI tooltip states export scope, failures retain drafts, temporary DOM/blob URLs are cleaned up.
- Updated README/SPEC. No subagents, dependencies, schema/backend changes, migrations, exotic technology deviation, TODOs, secrets or live data mutation.
- PASSED: 37 unit/tree/validation/renderer/history/export cases (3 new export regressions), final lint and optimized build including TypeScript. Unchanged 29 rules/API cases remain previously validated; no backend rerun needed. Browser download completion remains an open acceptance check alongside prior editor checks. Existing release gates unchanged.

### FAILED — 2026-10-03: export handler placement corrected

- First build caught download handler inserted into TaskDialog instead of Notes because both have save functions. Moved handler into Notes; final lint/build passed. No broken state remains.

### 2026-10-03 — Small increment: search saved note content

- Added workspace note search across saved titles and block text, with case-insensitive matching and normalized whitespace. Body matches show a bounded plain-text snippet; matching descendants retain their ancestor path even when collapsed. Accessible note names retain the title and associate the snippet as a description.
- Search uses only notes already loaded for the active workspace. Unsaved drafts become searchable after Save; attachments and tasks inside board blocks are not indexed. Updated README/SPEC.
- PASSED: 41 unit/tree/validation/renderer/history/export/search cases, lint, and optimized production build including TypeScript. Four new regressions cover normalized title/body matching, bounded literal snippets, collapsed ancestor retention and supported block text. Unchanged 29 rules/API cases remain previously validated; no server/schema/access code changed.
- OPEN TEST GAP: live snippet layout and mobile search acceptance remain unverified in browser alongside earlier editor/download checks. Existing browser-policy limitation and Firebase/license/dependency/deployed two-user release gates remain unchanged.
- No subagents, dependencies, schema/backend changes, migrations, exotic technology deviation, code TODOs, secrets or live data mutation.

### 2026-10-03 — Small increment: duplicate blocks

- Added Duplicate block to each block options menu. Inserts an independent copy immediately below, preserving text/type, heading level and checklist state; copying a board embeds the same shared workspace board without copying or mutating tasks. Copies remain drafts until Save and participate in existing Undo/Redo.
- Existing editor commit guards enforce block count, per-block length and total text limits. Duplication disables during Save and at 1,000 blocks; rejected oversized copies leave the current draft intact. Updated README/SPEC.
- PASSED: 43 unit/tree/validation/renderer/history/export/search/block tests, lint and production build including TypeScript. Two new regressions verify formatting, independent copies, insertion order, invalid indices and history reversal. Strengthened the original-text assertion and reran the two relevant cases successfully. Previously passed 29 rules/API cases unchanged; no server/schema/access changes.
- OPEN TEST GAP: block menu interaction, focus and mobile layout remain unverified in browser alongside prior acceptance gaps. Existing Firebase provisioning blocker, license decision, dependency review and deployed two-user gates remain unchanged.
- No subagents, dependencies, migrations, exotic technology deviation, code TODOs, secrets or live data changes.

### 2026-10-04 — Real-time collaboration: architecture investigation

- User requested production-grade simultaneous editing, durability, deterministic ordering, reconnect recovery and adversarial tests. Read project state, AGENTS, current schema/editor/drafts, Firebase client/server/rules, existing emulator tests and CI before implementation.
- Existing notes are revision-checked whole-array saves without block IDs; dirty drafts do not merge remote updates and survive navigation only in memory. Confirmed existing trusted API/member transactions and workspace listeners should be reused.
- Evaluated transactional per-block conflicts against Yjs same-block text merging; presented both and proceeded with the recommended Yjs direction after user asked to continue. No dependency installed. Wrote .agentic/COLLABORATION-PLAN.md with data flow, proposed boundaries, structural-ordering/open capacity decisions, offline outbox, security/migration, presence alternatives and final-state/adversarial acceptance plan.
- FAILED — investigation agent reached the account usage limit. Stopped the implementation agent immediately; it confirmed no file mutations. Application source, dependencies, schema and database remain unchanged. Full collaboration ticket is NOT implemented or complete; next is finalizing the shared model/ordering contract and building the pure synchronization harness when usage is available.
- Documentation-only checkpoint: git diff --check passes. No runtime tests rerun because application code unchanged; previous 43 unit and 29 rules/API cases remain the last runtime verification. New synchronization, browser and deployed two-user checks do not yet exist or pass. Existing provisioning/license/dependency gates remain open.

### 2026-10-04 — Bounded real-time collaboration implementation

- Resumed after the user confirmed usage reset. Reused the existing Firebase/member-authorized trusted API, workspace note subscription, editor and materialized NoteContent. Parallel model/backend/editor implementation was explicitly authorized; primary agent implemented durable controller/storage and conducted integration/adversarial review.
- Added Yjs incremental same-block text merging, stable UUIDs, permanent tombstones, deterministic fractional positions with disjoint UUID intervals, minimal move deltas and atomic format registers. Local actions and remote reconciliation have distinct origins; stale rendered actions produce intent against their captured CRDT baseline. Foreign document callbacks are fenced.
- Added idempotent transactional initialization/update routes, payload/UID/generation-bound permanent receipts and monotonic sequence. Legacy whole-content writes are fenced after promotion; metadata has independent CAS revisions. Trusted decoded/materialized validation checks schema, dependencies, identities, tombstones and size before acknowledgement. No browser write permission was relaxed.
- Implemented IndexedDB persist-before-send journals, bounded dependency-ordered batches, exact retry identities after response loss, acknowledged save statuses and explicit error/retry/Markdown recovery. Web Locks fence cloned-tab writers and drain persistence before release; closed-tab journals can be reclaimed atomically. Account/workspace/document scopes and late-callback guards protect navigation/auth changes. Retry rebuilds failed subscriptions; account-list responses are guarded against stale authentication.
- Updated inline editor stable identity/focus/menu handling, automatic content synchronization, separate title/location status, local text-only Undo/Redo and IME baseline buffering. Unfinished composition is marked unsaved and becomes durable on composition end. Recovery exports preserve unsent work even when the note/generation cannot be reopened.
- Added approximate presence using server-derived membership names, 90-second expiry and 45-second heartbeat; own leases cleaned up opportunistically and TTL is best-effort. Evaluated RTDB disconnect presence but avoided new cross-store authorization/provisioning for this bounded approximation. Presence is not proof of content durability.
- Migration 004 documents additive lazy promotion, maintained types (Firestore has no generated types), readable presence/private receipts, index exemptions/TTL, rollout/rollback and export/deletion. Clean isolated emulators verified affected shapes and authorization: notes/presence member-read, all browser writes denied, receipts default-denied. Note deletion fences operations and removes receipt/lease subcollections before parent removal so cleanup failures remain retryable. No live migration, secret or deployment.
- Exact dependencies: yjs 13.6.33 (MIT, npm metadata updated 2026-09-23), fractional-indexing 4.0.0 (CC0-1.0, updated 2026-06-25), fake-indexeddb 6.2.5 for transaction/recovery tests (Apache-2.0, updated 2025-11-07). Registry licenses/maintenance and upstream primary docs reviewed. Yjs was chosen over ad-hoc text merge because same-block simultaneous typing requires CRDT semantics; maintained fractional ordering was chosen over fragile numeric positions; fake-indexeddb exercises transaction behavior instead of mirroring storage implementation. Repository license decision remains open; permissive dependency licensing does not decide it.
- PASSED final: 81 unit/model/controller/IndexedDB/editor-helper cases, 9 rules suites and 31 trusted API cases (121 total), lint, standalone typecheck and optimized production build. Runtime audit remains 2 moderate/0 high findings; full install audit remains 16, unchanged. No code TODO/FIXME was found in new controller/model/storage/hook code.
- Dedicated adversarial review fixed stale baseline text replacement, pre-promotion cache poisoning, oversized batching, acknowledgement/journal loss, delayed writer lock release, malformed/oversized history, atomic concurrent formatting, hidden deleted text undo, rejected recovery exports, terminal-listener retry, auth response races, IME and retryable receipt cleanup. Regression evidence and full limits are in .agentic/COLLABORATION-VERIFICATION.md; README/SPEC/plan updated.
- OPEN ACCEPTANCE GAP: authenticated two-browser typing/caret/IME/mobile and deployed two-user checks have not run. Existing URL-security browser restriction was respected without alternate UI workarounds. .env.local is absent; Firebase project provisioning remains blocked. No screenshot, live collaboration deployment or production-readiness claim. The complete ticket definition of done is NOT met until browser/deployed acceptance passes.
- KNOWN LIMITS: small-team transactional checkpoints incur note-level contention; 64KB updates, 350KB binary checkpoints and 800KB combined JSON bound state/history, with no automatic compaction. Structural undo is unsupported. Concurrent textless-block conversion/typing can require explicit recovery. Browser storage clearing can lose unacknowledged work. These are documented limits, not silent shortcuts; no unrelated application rewrite.

### FAILED — 2026-10-04: verification issues resolved

- Initial emulator launch repeated the known Windows/Corretto AF_UNIX startup failure; retried using the already documented process-only nonexistent socket-directory workaround. Final clean rules/API suite passed; no machine settings changed.
- New acknowledgement/journal regression initially showed Retry waiting on an existing backoff timer. Retry now clears that timer; the full final 81-case suite passes, including acknowledgement followed by journal failure, invalid Undo rollback and durable shutdown.

### 2026-10-04 — Commit and push workflow

- User explicitly requested committing changes and pushing to the remote. Recorded the ongoing preference: commit coherent completed changes after relevant verification and push the current branch to origin without rewriting shared history.
- Working tree was clean; collaboration implementation already committed as 14547d7. Preparing to push that implementation and this documentation checkpoint on codex/teamspace-application to origin.
- Setup wizard remains a proposal, with guided setup versus automatic cloud provisioning awaiting a scope decision. No wizard implementation or authentication change was made.
- Documentation-only checkpoint: git diff --check validation; application checks remain the previously recorded 121 passing tests, lint/typecheck/build. No runtime code changed. Existing Firebase provisioning and browser acceptance gates remain open.

### 2026-10-04 — Guided setup iteration

- User authorized choosing features and committing/pushing every iteration. Chose the proposed guided setup slice; automatic cloud provisioning remains out of scope and undecided. Previous implementation and workflow checkpoint were successfully pushed to origin/codex/teamspace-application through da1c1d2.
- Added a local-preview floating setup button and five-step native modal guide with responsive navigation, heading focus, Escape close and trigger focus restoration. Closing/reopening retains the current step in mounted component state. Reserved page space for the floating action; mobile guide resets its scroll on navigation.
- Reused the existing Firebase config to show only presence booleans for the five bundled browser settings; no values or server configuration are exposed. Empty environment-template copy has a manual-selection fallback. Clearly distinguishes settings presence from successful connectivity and restart/redeployment from page reload.
- Guides Firebase, authorized domains, rules/indexes, Storage CORS/lifecycle/TTL and Vercel setup, then existing authenticated workspace creation. Workspace owner is explicitly distinct from Firebase administrator. Explains Identity Platform prerequisite and that MFA enrollment/challenge UI is not implemented. This iteration makes no auth/schema/permissions/data-retention changes, collects no credentials, provisions no resources and does not import preview data.
- Updated README/SPEC. No new dependency, migration, exotic technology deviation, code TODO, secret or live database change. Official Firebase TOTP documentation checked for prerequisites.
- PASSED: all 81 unit/model/controller/store/editor-helper tests, lint, standalone typecheck, final optimized production build and git diff --check. Previously validated 9 rules/31 API cases unchanged; not rerun because this slice changes no server/access/schema behavior.
- OPEN TEST GAP: no automated setup-dialog interaction suite or live keyboard/clipboard/mobile verification. Existing browser-tool restriction remains respected; compilation/tests do not substitute for browser acceptance. No new screenshot or production-readiness claim. Firebase provisioning, deployed two-user collaboration acceptance, repository license and dependency release review remain open.

### FAILED — 2026-10-04: setup guide lint corrected

- Initial lint rejected three unescaped apostrophes in JSX prose. Corrected the text; final lint/typecheck/build pass. No broken state remains.

### 2026-10-04 — OAuth setup and optional 2FA clarification

- User clarified that setup means user OAuth login, while retaining 2FA as optional by default. Made Google OAuth provider enablement, authorized domains and actual sign-in verification the main Sign-in & workspace guide step; linked official Firebase instructions.
- Moved authenticator guidance into a collapsed-by-default Optional 2FA section. Recorded opt-in policy in SPEC/README/Current Facts; no MFA requirement or pretend enablement toggle added. Enrollment/challenge implementation remains an explicit open feature, so app-level enrollment must stay disabled until supported and verified. Existing Google login and authorization behavior unchanged.
- PASSED: 81 unit/model/controller/store/editor-helper tests, lint, standalone typecheck, optimized production build and git diff --check. No server/schema/rules changes; previously validated 40 rules/API cases not rerun. No additional test for reversible guide copy; browser keyboard/mobile/dialog verification remains an open gap under the recorded browser-tool restriction.
- No dependency, migration, credential, live provider change or cloud provisioning. Previous guided setup iteration b9396f5 pushed successfully. This iteration will be committed/pushed per user preference; Firebase provisioning, deployed collaboration acceptance, licensing and dependency review gates remain open.

### 2026-10-04 — Board deadline focus

- User requested continuing remaining requirements and authorized selecting features plus committing/pushing each iteration. Extended the existing due-date and reusable shared-board experience with All tasks, Overdue, Due today, Next 7 days and No due date filters. Focused filters exclude completed work; count/clear controls combine with existing search/assignee filters. Each board view owns its filter; neither tasks nor shared data change when filtering.
- Main and note-embedded boards use the same component. Cards label Today/Overdue and include deadlines in accessible task names; date/footer content wraps on narrow cards. Equal task positions use a deterministic ID comparison for display without modifying stored positions.
- Replaced locale-dependent en-CA string comparison with explicit local calendar fields. Seven-day windows include today plus six calendar days, using calendar arithmetic across DST/month/year boundaries. A shared useSyncExternalStore day source avoids server/client timezone hydration disagreement; one timer/focus/visibility subscription serves all mounted boards, removed after the last subscriber unmounts. No additional Firebase listener/write.
- Added six pure deadline regressions, including an isolated Europe/Ljubljana process that verifies real 23-hour/25-hour transitions. Updated npm test entry, README/SPEC. No new dependency, schema, migration, permissions/auth change, exotic technology deviation, code TODO, secret or live data mutation.
- PASSED: final full 87-case unit/model/controller/store/editor-helper/deadline suite, lint, standalone typecheck, optimized production build and git diff --check. Previously validated 9 rules/31 API cases unchanged and not rerun because server/schema/access code did not change.
- OPEN TEST GAP: live filter selection, midnight/focus timer cleanup, screen-reader announcements and mobile/embedded board layout remain browser acceptance items under the existing browser-tool restriction; pure date tests do not verify DOM interaction. Firebase provisioning, deployed two-user acceptance, license/dependency release gates remain open. No production-readiness or screenshot claim.
- Previous OAuth clarification iteration fb40e27 pushed successfully. Preparing this verified iteration for commit/push on codex/teamspace-application per user preference.

### 2026-10-04 — Direct task actions and selective task saves

- User invited convenience-focused design/UX improvements. Added a native keyboard/touch Status control to main and embedded board cards, outside the task-details button. Card opening and dragging remain available; pending moves disable status/drag for that card. Per-board in-flight guards prevent duplicate submissions, move acknowledgements have live announcements, and failures expose Retry move. Focus returns to the stable due-date control unless the user has focused another control.
- Added a narrow client status action using the existing trusted PATCH endpoint, capturing the signed-in UID. Drag now uses the same status-only mutation rather than resending task snapshots. Reused existing member-authorized transactions and live task subscription; no server route or Firebase write permission changed. Board instances are keyed by workspace to fence pending feedback across navigation.
- Review found task detail saves still resending unchanged stale fields. Added a shared patch builder so saved dialogs submit only edited fields; no-op saves do not write. Preview saves merge patches into the latest existing task and reject missing IDs instead of recreating deleted tasks. Status-only preview mutations preserve every other task field. Same-field conflicts remain server commit order; no task CRDT/CAS architecture or schema change introduced.
- Added four unit cases for status-only field preservation, repeated status updates, missing-task rejection, selective detail patches and intentional nullable clears. Added two trusted API cases asserting final state for a simultaneous move/detail edit, safe duplicate status sets and missing-task rejection. Updated README/SPEC and npm test entry; no dependency, migration, exotic technology deviation, code TODO, secret or live data change.
- PASSED final: 91 unit/model/controller/store/editor-helper/task cases, all 9 rules suites and 33 trusted API cases (133 total), lint, standalone typecheck, optimized production build and git diff --check. Emulator used the documented process-only Windows/Corretto workaround and shut down successfully. Existing default-deny authorization remains verified.
- OPEN TEST GAP: direct status selection, pending/retry DOM behavior, drag from the revised card, focus restoration and mobile/embedded layout remain browser acceptance checks under the recorded tool restriction. Automated state/transaction tests do not verify those interactions. Deployed two-user collaboration, Firebase provisioning, license and dependency review gates remain open.
- Previous deadline iteration 55f3cc9 pushed successfully. Preparing this verified iteration for commit/push on codex/teamspace-application per user preference.

### 2026-10-04 — Page history investigation and pending policy choices

- User requested page history/restore first, commit it, then implement comments/mentions. Inspected saved-note/Yjs revision/generation data flow, shared subscriptions, recovery controller, trusted transactions, schema/rules/indexes and fenced recursive deletion. Previous direct-task iteration ac940f5 pushed successfully.
- Wrote .agentic/PAGE-HISTORY-PLAN.md with immutable snapshots, transactional capture/restore, revision CAS, retry receipts, generation fencing/recovery, membership security, local preview, export/deletion and final-state tests. Retention and restore-location scope are material data/schema decisions; asked two native questions under AGENTS.md's ambiguity/retention rules. No answer received at this checkpoint; dependent implementation has not started.
- Important recovery finding: current generation changes block the old controller and preserve pending work; restarting accepts a new generation only when the previous journal has no pending operations. History restore needs explicit clean-view reload and dirty-view recovery UX; resetting a generation alone would be incomplete.
- Documentation-only planning checkpoint. Application/schema/dependencies unchanged; last runtime evidence remains 91 unit cases, 9 rules suites and 33 API cases, lint/typecheck/build. No history feature or comments implemented, no production-readiness claim, no secret or live database change. Next: receive policy choices, implement/test history, commit/push it, then proceed to comments/mentions.
