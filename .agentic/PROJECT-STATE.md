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
| Secrets location | Server environment only; local .env.local gitignored | 2026-10-03 |
| Current milestone | Milestones 1–5 implemented/validated; Milestone 6 live release blocked | 2026-10-03 |

## Open decisions and release gates

- NEEDS DECISION: repository license before public distribution. Firebase SDK dependencies are Apache-2.0; emulator CLI is MIT.
- BLOCKED: no Firebase project configuration provided. Live authentication, deployment, signed uploads, and two-user acceptance need project provisioning.
- PASSED: 28 validation/rules/trusted-API tests, lint, typecheck, production build, desktop/mobile browser checks.
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
