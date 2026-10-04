# Teamspace

A college team workspace with a live Kanban board, nested shared notes, explicit conflict-safe note saving and private attachments. Next.js + Google sign-in + Firestore + Firebase Storage; Vercel hosting.

## Run locally

Use Node 22.13+ or Node 24 LTS, npm, and Java 21 for emulator tests.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Without Firebase configuration, the clearly labeled local preview saves tasks and notes only in this browser. It has no shared storage, authentication or attachments.

## Firebase setup

In local preview, use **Set up your workspace** to open the five-step setup guide. It shows which browser environment settings are present in the current build, supplies an empty copyable environment template, and explains Firebase/Vercel deployment, workspace ownership and launch checks. Presence of settings does not prove connectivity or correct rules. The guide does not provision resources, collect credentials, enroll MFA or import preview data. Browser configuration changes require restarting locally or redeploying; keep server credentials in the server environment. Authenticator enrollment is a future feature requiring Firebase Authentication with Identity Platform.

1. Create a Firebase project and register a Web app. Enable Authentication > Google. Add localhost and your deployment domain to authorized domains.
2. Create a Cloud Firestore database and Firebase Storage bucket. Enable the required Storage billing plan; configure budgets and alerts.
3. Copy `.env.example` to `.env.local`. Populate browser values from Web app settings. Populate server service-account values separately. Never expose server values through NEXT_PUBLIC or commit credentials.
4. Deploy rules/indexes: `npx firebase deploy --only firestore:rules,firestore:indexes,storage --project YOUR_PROJECT_ID`. All direct writes are denied. Only workspace members can read workspace content. Trusted server handlers validate and authorize every write.
5. Replace the example origins in `storage.cors.example.json`; apply with `gcloud storage buckets update gs://YOUR_BUCKET --cors-file=storage.cors.example.json`.
6. Configure a bucket lifecycle rule deleting objects under `staging/` after one day, to clean abandoned/recreated signed uploads.
7. Deploy TTL policies in `firestore.indexes.json`: `rateLimits.expiresAt` removes short-lived hashed counters and `attachments.expiresAt` clears abandoned pending reservations after 24 hours. Ready attachments have no expiry. TTL is eventual; expired invites and request counters are checked synchronously by the application.

### User sign-in and optional 2FA

Google OAuth through Firebase Authentication is the supported user login. The setup guide's **Sign-in & workspace** step walks through enabling the Google provider, authorizing app domains and testing sign-in before workspace creation. Follow [Firebase's Google sign-in guide](https://firebase.google.com/docs/auth/web/google-signin).

Two-factor authentication is **optional by default**, not a prerequisite for workspace setup. Its guidance is collapsed initially. Teamspace does not yet implement authenticator enrollment or second-factor challenges, so leave app-level enrollment disabled until that flow is supported and verified. Future enrollment must be an explicit user choice; Firebase TOTP requires [Authentication with Identity Platform](https://firebase.google.com/docs/auth/web/totp-mfa).

Invite tokens are random, hashed at rest, bounded and redeemed transactionally. Legacy/new notes use revision-checked saves; configured saved notes are promoted to transactional Yjs collaboration when opened with a clean draft. Title/location retain separate revision checks. Signed staging uploads are validated and promoted to private workspace paths. Downloads use short-lived signed URLs issued after membership checks; these are temporary bearer capabilities, never permanent public download tokens. Removed members cannot obtain new URLs, while already issued URLs expire shortly.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run test:rules
npm run build
```

The GitHub workflow repeats these checks on pushes and pull requests with Node 24,
Java 21 and no production credentials. Actions are pinned to verified commit IDs;
the runtime audit gate fails for high/critical findings. Moderate and development
tool findings still require review before release. The workflow itself has not
run remotely yet.

On this Windows/Corretto installation, emulator startup needs a process-only
workaround: set `JAVA_TOOL_OPTIONS` to
`-Djdk.net.unixdomain.tmpdir=Z:\teamspace-nonexistent` before `npm run test:rules`.
Use a nonexistent directory; see the baseline migration for the reason.

Rules tests use clean isolated emulators under demo-teamspace, never a live database. See migrations/ for schema and export/deletion policies. Before release, use two signed-in users to check live task updates, refresh persistence, simultaneous note-save conflicts, expired/revoked invites, membership removal, outsider SDK denial and private file access. Also check file orientation/transparency/screenshot legibility, cleanup, mobile layout and keyboard dialog use.

## Vercel deployment

Import the repository and add all environment variables. Use a separate Firebase project for previews when appropriate. Redeploy after changing NEXT_PUBLIC values because they are bundled at build time. Add deployment domains to Firebase auth and Storage CORS. Deploy rules to the same project as the app. Use Node 24 or a supported Node 22 release.

No project/deployment credentials are included. Production release is gated on configuration, external two-user acceptance and any unresolved dependency audit findings recorded in `.agentic/PROJECT-STATE.md`.

## Scope

One board per workspace; tasks with assignees and due dates; nested notes with headings, bold, bullets and safe links; owner-managed invitations, member removal and ownership transfer. Notes inherit workspace permissions at every depth. Configured saved notes support simultaneous text editing with Yjs; device-local preview remains explicit-save and has no shared access. Public publishing is outside the scope. SPEC.md records the agreed scope. A repository license must be selected before public distribution.

Create a root note, then use Add subnote to grow its tree. Breadcrumbs navigate back to ancestors. Change the parent and explicitly save to move a note together with its descendants; server transactions reject cycles and cross-workspace parents. Move or delete children before deleting a parent. Existing notes remain roots without a destructive data backfill; see `migrations/002-note-hierarchy.md`.

Notes are edited directly as text, heading and bulleted-list blocks. Use the block + button or type `/` for the block menu; Enter adds a block. Every saved note in the tree has a + button to add a subnote, plus a right-click/ellipsis menu. Save a new parent note before creating its children. Existing pages and permissions need no migration for this editor update.

Typing `# ` through `###### ` converts an empty text block into H1–H6. `- `, `1. `, `> ` and `[ ] ` create lists, quotes and tasks; triple backticks and horizontal-rule markers work with Space or Enter. Use `/markdown` for a live CommonMark/GFM block (tables, footnotes, images, code, emphasis and links); multiline Markdown paste uses this block. Use `/kanban` to embed the existing shared workspace board. Its cards and task editor are the same as Board view; removing the embed does not remove tasks. New/local-preview notes use Save; configured saved notes synchronize automatically. Schema deployment details: migrations/003-rich-note-blocks.md.


The block editor supports Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. It keeps up to 20 local checkpoints while the note stays open, groups continuous typing, and restores deleted/moved/converted blocks. Undo affects note blocks; shared board task changes remain independent. This snapshot history applies to new/local-preview notes; collaborative notes use the local text history described below.


Use Download Markdown in the note toolbar to download its current title and content, including unsaved edits, as a .md file. It preserves heading levels, checklists, code and raw Markdown. Board blocks become textual references; tasks, attachments and subnotes are not bundled. Export does not save or change the note.


Workspace search finds saved note titles and body text, showing a short snippet for content matches and retaining the note's ancestor path. Unsaved edits become searchable after Save. Attachments and tasks inside board blocks are not indexed as note text.

Each block's options menu offers Duplicate block. Copies appear immediately below with their formatting intact. They synchronize automatically in collaborative notes; other notes retain them as drafts until Save. Undo removes the copy. Duplicating a board block adds another view of the same workspace board; it does not copy tasks. Existing note size limits apply.

The main board and embedded boards offer a Due date filter: All tasks, Overdue, Due today, Next 7 days (today plus six days), or No due date. Focused filters show open tasks only; All tasks includes completed work. Filters combine with the main board's search/assignee selection, stay local to each board view, and never alter shared task data. Cards label Today/Overdue using the viewer's local calendar date; day changes reconcile within 30 seconds or when the window regains focus.

Move tasks directly with each card's Status control; opening task details or dragging is optional. Main and embedded boards share pending feedback, acknowledged move announcements and a Retry move control. Quick moves (including drag) patch only status so they preserve concurrent edits to other fields; same-field status conflicts still follow the server's transaction commit order. Preview moves update the latest saved task and never recreate a deleted one. Keyboard moves return focus to the board's stable due-date control when the card moves or disappears from a filtered view.

Task detail saves also send only edited fields. An unchanged title, status, date or assignee is not resent from a stale dialog; independent concurrent changes survive. Same-field task conflicts remain last committed write rather than CRDT merges. Local preview applies patches to its latest task data and rejects updates to missing tasks.

## Real-time notes

With Firebase configured, opening a clean saved note promotes it once to Yjs collaboration. Typing, adding, deleting and moving blocks synchronize automatically; two users can type in the same block. Title/location use their own explicit Save and revision checks. New notes and local preview keep explicit Save. Save or export an existing dirty legacy draft before promotion.

Completed edits persist in IndexedDB before transmission. Saved requires server acknowledgement and durable local bookkeeping. Offline work resumes when connected; a lost response retries the same operation exactly once. Switching notes keeps pending work on the device until that note is reopened. Web Locks prevent duplicated tabs from sharing a journal writer; a new session can recover pending journals left by closed tabs. Use a current browser supporting secure-context Web Locks, IndexedDB and session storage. Storage failure is explicit; Retry rebuilds synchronization, and Download Markdown exports a rejected recovery copy when necessary.

Collaborative Undo/Redo affects local text only; structural actions do not use snapshot undo. Deleting blocks clears text history. A history action incompatible with current remote formatting/capacity is rejected without changing content. IME becomes durable on composition end; unfinished composition is marked unsaved. Presence is approximate recent viewing, using 90-second server leases and 45-second heartbeats.

Deploy `migrations/004-realtime-collaboration.md` rules/index changes, presence expiry TTL and trusted routes before the updated client. No live database was migrated during development. Promoted documents reject old whole-content saves; rolling back clients alone does not restore legacy editing. Checkpoints/materialized content are atomically merged, bounded and subject to document contention; this implementation targets small teams, with explicit 64KB update/350KB checkpoint limits rather than unlimited history. Conversion to a textless board/divider concurrent with typing may require explicit recovery.

See `.agentic/COLLABORATION-VERIFICATION.md` for invariants, adversarial fixes and test coverage. Authenticated two-browser caret/IME/mobile and deployed acceptance remain open; this is not a production-release claim. Pending edits cleared from browser storage cannot be recovered unless already acknowledged by the server.
