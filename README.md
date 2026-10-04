# Teamspace

A college team workspace with a live Kanban board, nested shared notes, conflict-safe collaborative editing and private attachments. Next.js with either Firebase or Supabase for the entire deployment; Vercel hosting.

## Run locally

Use Node 22.13+ or Node 24 LTS, npm, and Java 21 for emulator tests.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Without backend configuration, the clearly labeled local preview saves tasks and notes only in this browser. It has no shared storage, authentication or attachments.

## Choose a backend

Set both `BACKEND_PROVIDER` and `NEXT_PUBLIC_BACKEND_PROVIDER` to `firebase` or
`supabase`. They must agree; rebuild/redeploy after changing browser variables.
Every workspace in an installation uses the selected backend. Switching these
settings does not transfer accounts, files or content from the other backend.
Use a new installation or an explicitly planned migration for existing data.

`PASSWORD_AUTH_ENABLED=true` enables email/password registration and login.
`GOOGLE_AUTH_ENABLED=false` hides Google login when OAuth is unwanted. Enable or
disable the corresponding providers in Firebase/Supabase administration too;
application flags do not provision external providers. Both flags are strict
booleans. Enable at least one login method.

`EMAIL_CONFIRMATION_REQUIRED=true` requires confirmed email before accessing
shared workspaces; `false` permits access immediately after registration when
the provider's own confirmation setting permits it. The same policy must be
published into database security configuration, protecting direct reads as well
as trusted API requests. Follow the provider migration instructions before
launch. Do not turn off verification just to work around missing email delivery.

### Supabase: managed project

Create a Supabase project. Copy app settings from `.env.supabase.example` into
`.env.local` or Vercel, setting browser URL/anonymous key and server URL/service
role key from that same project. Keep the service role key server-only. Apply
`migrations/007-supabase-backend.sql` using the administrative SQL connection,
then publish the authentication security policy as described in the migration.
The application uses a private `teamspace-private` Storage bucket. Configure
email/password, confirmation policy, redirect URLs and SMTP in Supabase Auth;
Google is optional. Configure email delivery for verification and password reset.

### Supabase: self-hosted Docker

Docker Compose **2.24.4+**, Git and Node are required. This downloads the complete
official Supabase stack pinned to `self-hosted/v0.8.2`, including its database
initialization and gateway configuration. Supabase runs separately from the
Next app; start the app normally or deploy it to Vercel.

```sh
node scripts/prepare-supabase.mjs
node scripts/supabase-env.mjs
docker compose --env-file .env.supabase -f docker.compose.supabase.yml up -d
```

The second command creates `.env.supabase` with fresh, aligned keys and refuses
to overwrite an existing file. It never prints credentials. Before starting,
edit that gitignored file: configure SMTP and app/Auth/public URLs, then copy
only the required app variables into `.env.local` or Vercel. The example has
empty credentials and cannot start as-is. Google OAuth is disabled by default;
classic email/password login is enabled. `EMAIL_CONFIRMATION_REQUIRED` also
controls self-hosted Auth's email autoconfirm behavior.

Apply the application SQL migration to the running database; upstream's first
startup creates Supabase's own schemas, not Teamspace's application tables.
The Compose override binds API/database ports to localhost. For remote access,
use a TLS reverse proxy and explicit firewall rules, replace localhost URLs and
configure allowed redirects. A Vercel deployment needs a reachable HTTPS
Supabase endpoint. Keep Studio and database administration private.

Validate configuration without starting services or printing secrets:
`node scripts/check-supabase-compose.mjs`. Never paste the output of ordinary
`docker compose config` into a public issue because it includes credentials.
Database/files persist in `.supabase/upstream/docker/volumes` and Docker volumes;
back up both plus configuration. `down --volumes` and deleting that directory
can destroy data. Fresh install scripts do not rotate existing keys. Plan key
rotation and upgrades explicitly; review the pinned upstream license/notices
and [official self-hosting guidance](https://supabase.com/docs/guides/self-hosting/docker).

## Firebase setup

In local preview, use **Set up your workspace** to open the five-step setup guide. It shows which browser environment settings are present in the current build, supplies an empty copyable environment template, and explains Firebase/Vercel deployment, workspace ownership and launch checks. Presence of settings does not prove connectivity or correct rules. The guide does not provision resources, collect credentials, enroll MFA or import preview data. Browser configuration changes require restarting locally or redeploying; keep server credentials in the server environment. Authenticator enrollment is a future feature requiring Firebase Authentication with Identity Platform.

1. Create a Firebase project and register a Web app. Enable Authentication > Email/Password for classic login; enable Google only when wanted. Add localhost and your deployment domain to authorized domains.
2. Create a Cloud Firestore database and Firebase Storage bucket. Enable the required Storage billing plan; configure budgets and alerts.
3. Copy `.env.example` to `.env.local`. Populate browser values from Web app settings. Populate server service-account values separately. Never expose server values through NEXT_PUBLIC or commit credentials.
4. Deploy rules/indexes: `npx firebase deploy --only firestore:rules,firestore:indexes,storage --project YOUR_PROJECT_ID`. All direct writes are denied. Only workspace members can read workspace content. Trusted server handlers validate and authorize every write.
5. Replace the example origins in `storage.cors.example.json`; apply with `gcloud storage buckets update gs://YOUR_BUCKET --cors-file=storage.cors.example.json`.
6. Configure a bucket lifecycle rule deleting objects under `staging/` after one day, to clean abandoned/recreated signed uploads.
7. Deploy TTL policies in `firestore.indexes.json`: `rateLimits.expiresAt` removes short-lived hashed counters and `attachments.expiresAt` clears abandoned pending reservations after 24 hours. `presence.expiresAt` cleans up viewing leases; `historyVersions.expiresAt` removes automatic versions after 30 days. Ready attachments and named versions have no expiry. TTL is eventual; expiration is also enforced by the application.
8. Publish the confirmation policy with `node --env-file=.env.local scripts/publish-auth-policy.mjs`. Re-publish whenever `EMAIL_CONFIRMATION_REQUIRED` changes. Missing policy requires confirmation; a policy/environment mismatch blocks trusted requests.

### User sign-in and optional 2FA

Email/password registration and login work with either backend. Verification,
resend and password reset use the provider's Auth service. Configure provider
password policies, email templates and abuse limits; Firebase administrators
should enable email enumeration protection. Google OAuth remains optional.
The setup guide's **Sign-in & workspace** step explains provider setup and
domain authorization. See [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth),
[Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
and [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin).

Two-factor authentication is **optional by default**, not a prerequisite for workspace setup. Its guidance is collapsed initially. Teamspace does not yet implement authenticator enrollment or second-factor challenges, so leave app-level enrollment disabled until that flow is supported and verified. Future enrollment must be an explicit user choice; Firebase TOTP requires [Authentication with Identity Platform](https://firebase.google.com/docs/auth/web/totp-mfa).

Invite tokens are random, hashed at rest, bounded and redeemed transactionally. Legacy/new notes use revision-checked saves; configured saved notes are promoted to transactional Yjs collaboration when opened with a clean draft. Title/location retain separate revision checks. Signed staging uploads are validated and promoted to private workspace paths. Downloads use short-lived signed URLs issued after membership checks; these are temporary bearer capabilities, never permanent public download tokens. Removed members cannot obtain new URLs, while already issued URLs expire shortly.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run test:rules
npm run test:supabase
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

Supabase integration tests require Docker. They create and remove their own
isolated PostgreSQL container, with no exposed port or production credentials.
They exercise the migration, real RLS/transactions and shared API final states.
They do not replace live Auth/Storage or two-browser acceptance. Schedule
`scripts/prune-supabase.mjs` hourly to preserve expiry and staging cleanup; see
[migration 007](migrations/007-supabase-backend.md) for security policy and setup.

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

## Page history and restore

Saved pages have a History action with dated version previews and Markdown downloads. Automatic checkpoints capture the first saved state and then saved activity at most every five minutes; they remain available for 30 days. Save version keeps a named snapshot permanently until page deletion. One name is allowed per saved revision. Local preview offers the same controls, with history stored only in this browser.

Restore requires a clean, acknowledged page and confirmation. It restores title/content while preserving location, children, attachments and shared board tasks, and keeps a backup of the saved page first. Concurrent changes invalidate the reviewed revision; refresh the review instead of overwriting them. An uncertain restore response offers an identical idempotent retry.

A restore starts a fresh collaboration generation. Other viewers reload synchronization with Retry. Pending edits from the old generation stay blocked and downloadable; Keep recovery locally & reload archives them atomically in this browser before reopening the restored page. Download archived recovery exports the most recent local archive. Archives are not cloud versions and are lost if browser data is cleared; closed stale journals may need separate recovery when reopened.

Deploy the additive schema/index/TTL configuration described in `migrations/005-page-history.md` before using the updated client. Version reads and restores are member-authorized trusted transactions; direct SDK access remains denied. Named versions and retry receipts grow until page deletion. Full workspace export and browser interaction acceptance remain open features/checks.

## Page and task conversations

Saved pages and task details have a shared conversation showing the latest 50 messages. Add plain-text messages, choose a workspace member to insert an @mention, delete your own messages, or download the visible conversation as Markdown. Conversations survive page history restore; deleting the page or task removes its conversation. New pages/tasks need to be saved first. Preview conversations and drafts stay on this device.

Messages post independently of the editor. Pending messages show their status and retain an exact retry identity/body before transmission, so refresh or a lost response cannot duplicate a retry. Browser storage failures keep the draft visible and offer recovery; posting waits until recovery storage works. One tab per account/conversation owns the draft writer lock; other tabs can read messages and retry composer access after the owning tab closes. Different members can post simultaneously.

If an uncertain retry is rejected after access is removed or the parent is deleted, its original identity remains retained. Download/copy the draft for recovery; the rejection cannot prove whether the earlier attempt committed. Browser-local recovery can outlive its server conversation and is removed by clearing browser data.

Mentions identify current workspace members and render as safe labels; they do not send notifications or email in this iteration. Messages are immutable except author deletion, which erases text/mentions and leaves a tombstone to prevent stale retries from resurrecting them. Older messages remain stored but pagination/editing/moderation are later features. Full export is separate; the conversation download covers only the visible latest-50 window.

Deploy the rules/index configuration in `migrations/006-conversations.md` before the updated API/client. Conversation reads require current membership and a live parent; browser writes remain denied. Trusted mutations validate author identity, mentions, bounds and rate limits. Browser interaction and authenticated two-user acceptance remain required release checks.
