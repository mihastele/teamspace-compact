# Teamspace — hackathon build spec

## Purpose

A small shared workspace for a college team: track work on a Kanban board and keep project notes beside it. Prioritize reliable saving, clear permissions, and quick navigation.

## Agreed stack

- Next.js App Router, React, TypeScript; deploy to Vercel.
- Authentication: email/password registration/login with optional Google OAuth, on the deployment's selected Firebase or Supabase backend.
- Durable data: Cloud Firestore, or Supabase PostgreSQL with transactional document records, membership RLS and guarded live subscriptions.
- Private attachments: Firebase Storage (requires Blaze billing), or private Supabase Storage.
- No MinIO or separate object-storage server.
- Plain CSS for the first slice; reusable design tokens and components.

## Tonight's scope

1. Sign in, create a workspace, invite teammates by a shareable token, join a workspace.
2. One board per workspace with To do, In progress, Done.
3. Create, edit, delete, assign, and move tasks. Optional due date and description.
4. Create, edit, and delete nested notes with headings, bold, lists, and links. Root notes can contain subnotes at any depth; all inherit workspace membership.
5. Shared task updates through Firestore listeners. Configured saved notes use Yjs synchronization for simultaneous typing and blocks; title/location and new/local-preview notes use explicit revision-checked Save. Conflicting metadata saves must never silently overwrite another person's work.
6. Upload images and PDFs to tasks or notes; view and delete attachments.
7. Responsive interface, loading/empty/error states, keyboard-accessible controls.

Multiple independent custom databases, AI, notifications and public publishing remain outside scope. The user selected custom fields on the existing workspace board on October 4. Nested notes were added October 3; simultaneous text/block collaboration was added October 4 at the user's request. Browser/deployed acceptance remains a release gate.

### Custom board fields

The existing shared workspace board supports up to 32 named Text, Select,
Multi-select and Date properties, with up to 50 named options per select field.
Properties are added/renamed through Board → Properties, including note embeds.
Task details edits values; populated values appear on cards. Stable UUIDs preserve
selections when field/option names change. Types and existing option IDs cannot
be replaced or deleted in this increment. Dates are date-only YYYY-MM-DD; the
calendar still uses the built-in Due date. Text values are bounded at 2,000 characters.

Definitions use expected-revision checks and member-authorized trusted mutations.
Task patches merge only edited custom keys into current saved values; server
validation rejects foreign properties/options, duplicates and impossible dates.
Definitions are at `workspaces/{id}/boardProperties/{uuid}`; task values are an
optional `propertyValues` map. Member read/server write access applies on both
providers. Migration 009 and the maintained TypeScript models document the shape.
Download board JSON exports all saved tasks and definitions; attachments and
conversations are excluded. Task deletion removes its values. Definitions remain
for the workspace lifetime; full workspace deletion remains a separate open feature.
Linked board views and synced text references are implemented as described below.

## Main screens and behavior

- Sign-in: classic registration/login, verification/resend and password reset, plus optional Google; actionable authentication errors.
- Workspace: sidebar with workspace name, Board, Notes, and Members.
- Board: three columns, task count, Add task. Card shows title, assignee, due date. Detail editor holds description and attachments. Drag moves a card; a status selector provides keyboard/touch fallback.
- Notes: expandable document tree, root/subnote creation, clickable breadcrumbs, and parent selection to move notes; visible synchronization status for live content and separate title/location save status. New/local-preview notes use explicit Save; configured saved notes synchronize text and blocks automatically. If the remote revision changes while editing, keep the local draft and offer reload/copy instead of overwriting. Clean notes reflect saved teammate changes. Parent moves and title changes use independent metadata revision checks. Move/delete child notes before deleting their parent; no implicit cascading deletion.
- Members: member list, invite links and direct registered-account addition. Workspace admins manage invitations and ordinary members; owners/root admins manage administrator roles. Members can leave; the owner must transfer ownership before leaving. Invite links use configured domain names (`APP_URL` / `SITE_URL` / `NEXT_PUBLIC_APP_URL`) or request host headers rather than a hardcoded loopback origin.
- Missing backend configuration: clearly labeled local prototype. No claim of shared data or authenticated access.

## Design

Compact white working surface, dark navy navigation, cobalt actions, subtle borders, readable typography. Open directly on the board. Task details appear in a dialog. On mobile, navigation collapses and columns stack. Respect reduced motion and visible focus.

## Data model

All timestamps are server timestamps; identifiers are generated IDs.

| Path                             | Fields                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users/{uid}                      | displayName, photoURL, createdAt                                                                                                                                |
| workspaces/{id}                  | name, ownerId, createdAt, noteTreeRevision (structural transaction coordination)                                                                                |
| workspaces/{id}/members/{uid}    | role: owner/admin/member, displayName, joinedAt; optional addedBy, roleUpdatedBy, roleUpdatedAt                                                                  |
| workspaces/{id}/tasks/{id}       | title, description, status: todo/doing/done, assigneeId or null, dueDate: YYYY-MM-DD or null, position, createdBy, createdAt, updatedAt                         |
| workspaces/{id}/notes/{id}       | title, parentId: same-workspace note ID or null, content: editor JSON, revision, createdBy, createdAt, updatedAt, updatedBy; missing legacy parentId means root |
| workspaces/{id}/attachments/{id} | parentType, parentId, storagePath, originalName, contentType, bytes, uploadedBy, createdAt                                                                      |
| invites/{tokenHash}              | workspaceId, createdBy, expiresAt, revokedAt or null, maxUses, uses                                                                                             |

Only a trusted server creates/redeems invitations. Validate Firebase ID tokens, check membership, and update membership/invite usage in a transaction. Use random high-entropy tokens; store hashes. Do not make membership self-writable through client rules. Admin SDK bypasses rules, so server handlers must repeat authorization checks.

## Security and collaboration

- Default-deny Firestore and Storage rules.
- Only authenticated workspace members can read/write that workspace's tasks, notes, and attachments.
- Workspace access administration uses trusted server handlers: workspace admins manage ordinary membership/invitations; owners/root admins manage admin roles; only owners transfer ownership.
- Validate allowed fields, lengths, status values, immutable creator fields, and assigned membership.
- Notes save through a transaction that checks the expected revision and increments it.
- Hierarchy mutations validate the full parent chain inside a transaction, reject cycles/missing/deleting parents, and coordinate with parent deletion. Notes and their descendants always remain within one workspace's access boundary.
- Firestore listeners subscribe only to the active workspace and unsubscribe on navigation/sign-out.
- Render editor content safely; reject unsafe link protocols. Never render unsanitized HTML.
- Keep Admin SDK secrets in server environment variables. NEXT_PUBLIC Firebase configuration is client configuration, not an authorization boundary.

## Attachments and compression

- Initially accept JPEG, PNG, WebP, and PDF; maximum source file 15 MB, stored file 10 MB. Validate again in rules/server as appropriate.
- Photos: preserve aspect ratio, cap longest edge at 2,048 px, no upscaling, WebP quality 0.82 starting point; thumbnail capped at 400 px.
- Text screenshots/diagrams: retain PNG to keep text sharp. Explicit Keep original option, subject to file limit.
- Preserve transparency and verify orientation. Compression quality is a target, not a promise of identical detail. PDFs remain unchanged.
- Storage path: workspaces/{workspaceId}/{parentType}/{parentId}/{attachmentId}/{filename}.
- Private authenticated downloads. Do not save permanent public download tokens as the access-control mechanism.
- Do not embed image binaries in Firestore. Delete orphaned uploads after failed metadata writes; delete Storage objects when removing attachments.

## 195-minute sequence

| Minutes | Deliverable                                                                     |
| ------- | ------------------------------------------------------------------------------- |
| 0–20    | Spec, starter, board layout, Firebase project setup                             |
| 20–65   | Authentication, workspace creation/joining, membership rules                    |
| 65–110  | Persisted task editing/moving and shared updates                                |
| 110–150 | Notes editor, save state, revision conflict handling                            |
| 150–170 | Attachments and image compression                                               |
| 170–195 | Permission checks, mobile checks, build, Vercel deployment, two-user smoke test |

If time runs short, defer attachments first; label incomplete work explicitly. Never substitute device-local data for shared team functionality.

## Acceptance checks

- Two signed-in members see a task move without refreshing.
- Refresh preserves tasks and notes.
- A nonmember cannot read or mutate workspace data or files, even using SDK calls directly.
- Expired/revoked invites fail; owner-only operations reject regular members.
- Concurrent note saves raise a conflict and preserve the losing user's draft.
- Root, child, and grandchild notes survive refresh. Moves preserve descendants, cannot form cycles even under concurrent moves, and cannot cross workspace boundaries. Deleting a parent with children fails without deleting any content.
- Failed saves/uploads show errors and retain user input.
- Task status can be changed without dragging; dialog has keyboard focus handling.
- Compressed photos and screenshot text remain usable; oversized/unsupported files fail clearly.
- Production build passes; authentication works on the deployed authorized domain.

## Current implementation milestone

The application UI, Firebase client integration, trusted API handlers, default-deny rules, indexes and baseline schema are implemented. Automated validation/rules/API checks pass. Earlier local browser checks covered the previous interface; collaboration browser acceptance remains open. Without Firebase configuration the app remains a clearly labeled device-local preview. Production release still requires project provisioning, deployed Google sign-in, real two-user acceptance, Storage CORS/lifecycle setup and dependency-audit review. See README.md and .agentic/PROJECT-STATE.md.

### Notes interaction refinement — 2026-10-03

- Every saved tree row offers Add subnote via a visible + button, ellipsis menu and right-click menu; keyboard context-menu activation is supported. Creating a child selects its parent location and focuses the new title; saving reveals it under that parent.
- Edit paragraph, heading and bullet blocks directly with their visual formatting. A +/slash menu adds or converts blocks, keyboard editing creates/removes blocks, and controls reorder blocks. Keep the existing validated content schema and explicit-save/revision-conflict semantics.
- Preserve existing block type/text without a Markdown serialization round-trip; no schema migration or new editor dependency in this refinement.

### Markdown and board embedding — 2026-10-03

- Typing a heading prefix followed by Space converts it to the matching H1–H6 block; distinguish heading levels after save/reload. Add standard list, task-list, quote, divider and code shortcuts.
- Offer safe CommonMark/GFM rendering, including emphasis, inline/fenced code, links, images, tables, footnotes, strikethrough and task lists, in a live Markdown block. Raw HTML is not interpreted. Structured blocks remain directly editable; complex Markdown source retains a live rendered view.
- User chose embedding the existing shared workspace board, not independent page boards. Insert it anywhere in the block sequence via slash/+ menu. Reuse board task controls and trusted mutations; removing the embed preserves all tasks.


### Small increment: recoverable block edits — 2026-10-03

- Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y recover block content, conversion, deletion and reordering. Group continuous typing in the same block and retain up to 20 checkpoints.
- History is local to the currently open note and clears when navigating to another note or accepting different remote content. Undo does not save automatically, revert note title/location, or reverse shared Kanban task mutations. Disabled while saving.


### Small increment: note Markdown download — 2026-10-03

- Download Markdown exports the current note title and block content, including unsaved/conflicting drafts, without saving or mutating workspace data. Retain Unicode text, heading levels, checklist states and multiline code/Markdown.
- Download a portable .md filename locally. Export only this note: board blocks remain textual references; task data, attachments and child notes are not bundled. Failed downloads keep the draft intact.


### Small increment: search note content — 2026-10-03

- Workspace search matches saved note titles and textual blocks, case-insensitively with whitespace normalization. Show a bounded plain-text excerpt for body matches and preserve matching descendants' ancestor context.
- Search uses only notes already loaded for the active workspace; it does not fetch other workspace content or index unsaved drafts/attachments/embedded task data.

### Small increment: duplicate blocks — 2026-10-03

- Duplicate block in each block's options inserts a copy immediately below, preserving type, text, heading level and checklist state. The operation participates in local Undo/Redo and explicit Save.
- Board copies reference the same shared workspace board. Existing block/text limits apply; oversized copies retain the original draft and show feedback.

### Real-time collaboration upgrade — 2026-10-04

- Clean saved notes in configured workspaces promote once to stable-ID Yjs documents. Text and blocks sync automatically with optimistic local edits, deterministic ordering, permanent deletion tombstones and trusted transactional receipts. Existing dirty legacy drafts must be saved or exported before promotion.
- Pending completed operations persist in account/workspace/document-scoped IndexedDB journals with tab ownership locks. Reconnect/refresh retries unchanged operation IDs/bytes; acknowledgements and remote snapshots never replace newer local work or create feedback writes. Show Saving, Saved, Offline, Syncing or Sync failed; preserve rejected work with Retry and Markdown recovery.
- Title/location keep independent metadata revision checks. Local text Undo/Redo preserves remote changes; structural undo is unsupported. IME commits at composition end and marks unfinished input unsaved.
- Approximate document-viewing leases expire after 90 seconds and heartbeat every 45 seconds. Browser writes remain denied; trusted API and readable presence enforce membership. Receipts remain private.
- Updates/checkpoints are bounded (64KB/350KB binary; 800KB combined JSON). This transactional checkpoint foundation targets small team documents and does not claim unlimited history or scale. Migration 004 documents rollout, export/deletion, rules and indexes.
- Automated final-state/concurrency/recovery/security evidence and known limitations live in .agentic/COLLABORATION-VERIFICATION.md. Authenticated two-browser/IME/mobile/deployed acceptance is still required before this ticket is complete.

### Guided setup — 2026-10-04

- Local preview offers a floating setup button and five-step accessible modal guide, with browser setting presence indicators and an empty environment template. No credentials are collected or persisted; no cloud provisioning or preview-data import occurs.
- Distinguish workspace ownership from project administration and provider enablement from implemented MFA enrollment. Explain restart/redeployment and mark launch checks as manual, rather than claiming successful configuration.
- User login supports email/password and optional Google OAuth on the selected backend. Include provider enablement, confirmation policy, authorized domains and sign-in verification in the Sign-in & workspace step. Keep 2FA guidance collapsed and optional by default; future enrollment is opt-in, and no app-level MFA requirement is introduced.

### Board deadline focus — 2026-10-04

- Main and embedded shared boards offer All tasks, Overdue, Due today, Next 7 days and No due date filters. Focused views exclude completed work, combine with existing search/assignee filtering and show result counts and a clear-filter control. No data/schema change.
- Today and overdue labels follow the viewer's local calendar day rather than UTC or locale-specific date string formatting. The seven-day window includes today through six calendar days later; refresh labels on day rollover, focus and visibility changes without extra Firebase subscriptions.

### Direct task status controls — 2026-10-04

- Every main/embedded board card has a native keyboard/touch Status control outside its task-details button. Show Moving while pending, announce acknowledged moves and expose retry on failure. Prevent duplicate in-flight moves within a board view and disable dragging the pending card.
- Quick moves and drag submit status-only trusted patches, preserving independent concurrent task-field edits. Never recreate missing tasks. Restore stable board-control focus after keyboard moves without stealing focus from another active control.
- Task dialogs save only edited fields; unchanged stale fields cannot replace independent teammate updates. Same-field task conflicts follow server transaction commit order; no CRDT task-field merging is claimed.

### Page history and restore — 2026-10-04

- Automatic checkpoints capture saved activity at most every five minutes and expire after 30 days; permanent named snapshots remain until page deletion. Expiry is enforced before eventual TTL cleanup. History lists are paginated summaries with selected content fetched separately.
- Restore title/content only, preserving location, children, attachments and board tasks. Require the reviewed revision and a payload-bound operation UUID, retain a pre-restore backup atomically, and acknowledge duplicate retries without applying twice.
- A restore uses a fresh Yjs generation. Reject stale-generation edits, retain local pending work for Markdown recovery, and offer atomic device-local archival before reloading synchronization. Remote events never write local edits back.
- History/receipts remain private to trusted member-authorized APIs. Naming and restoring are rate limited. Page deletion fences writes and removes all versions/receipts; migration 005 documents rollout and export/deletion. Local preview mirrors visible behavior with atomic browser persistence and device-local labeling.
- Local recovery archives lists archived generations for the current account/workspace/page with bounded metadata pages, date/identity cursor ordering and explicit refresh. Decode/export a selected archive on demand; unreadable copies never hide other entries or change stored data. Keep live journals separate, reject foreign archive IDs/cursors and fence late UI/download results on navigation. Linked-source recovery offers the same browser. Archives remain device-local, are never replayed and retain the existing browser-data lifetime; export labels use the current title, not a historical title.
- Automated concurrency/recovery/security tests are required; live two-user restore, IME, modal focus, downloads and mobile acceptance remain external verification gates.

### Page/task conversations and mentions — 2026-10-04

- Saved pages and tasks have independent, live, latest-50 conversations. Individual block comments are deferred by user choice. Messages are immutable, plain text, with author-only deletion and Markdown export of the visible window.
- @mentions use current workspace membership and server-resolved identities/names. Render message text and member names safely; notification delivery/inbox/email remain outside this iteration.
- Posting is optimistic, acknowledged explicitly and idempotent by authenticated UID plus operation UUID. Persist exact body/identity before sending; uncertain responses retain that request across refresh. Fence same-account draft writers across tabs. Storage failure keeps recovery visible and blocks transmission until durable.
- Default-deny browser writes remain; reads require membership and a live parent. Server transactions validate bounds, author, mentions and posting/deletion rate limits. Tombstones erase message text/mentions and prevent stale duplicate resurrection. Conversation storage is removed through fenced parent deletion and remains intact during page restore.
- Migration 006 documents additive schema, indexing, access control, retention/export/deletion and rollback. Older-message pagination, editing, moderation, notifications and block anchors remain later features. Browser interaction/real two-user acceptance remains an external gate.

## Alternative backend and classic login

- The administrator selects one backend per deployment using matching BACKEND_PROVIDER and NEXT_PUBLIC_BACKEND_PROVIDER values. Switching providers does not transfer existing accounts/content/files.
- Preserve the same trusted authorization, transactional collaboration, history, conversations, attachment validation and recovery behavior for Firebase and Supabase.
- Support email/password registration, login, verification/resend and reset. GOOGLE_AUTH_ENABLED makes Google optional; PASSWORD_AUTH_ENABLED controls classic login.
- EMAIL_CONFIRMATION_REQUIRED is a strict boolean, default true. Publish the matching database read policy; enforce it on direct reads and trusted API requests.
- Supply docker.compose.supabase.yml, .env.supabase.example, pinned upstream preparation, fresh credential generation, schema migration and expiry/staging cleanup instructions. Never expose server keys through the setup guide or client variables.
- Keep app-level 2FA optional and enrollment disabled until its future flow is implemented.

### Shared task calendar — 2026-10-04

- Calendar navigation offers a Monday-first month grid, selected-day task list and agenda. Show unfinished overdue tasks separately; offer completed-task visibility and an undated list. Workspace search and My tasks apply to calendar and board alike.
- Task details reuse the existing editor, attachments and conversations. Add task for this day prefills its deadline; rescheduling through task details updates both views through existing shared subscriptions. Calendar navigation never mutates task data.
- Deadlines remain date-only, interpreted against the viewer's local day. Date arithmetic and labels avoid timezone/DST shifts. Support Today, previous/next month and keyboard day/week/month navigation with visible selected-day focus.
- No separate events, recurrence, external calendar integrations or drag-to-reschedule in this iteration. No schema, dependency or authorization change. Local preview remains device-local.

### Shared task table — 2026-10-04

- Table navigation displays the same shared tasks as Board and Calendar, with built-in title/status/assignee/deadline and named custom-field columns. Task titles open the existing trusted task editor; Add task and Properties reuse current controls.
- Column headings cycle ascending, descending and original board order. Sort select/multi-select fields by displayed option names, status by workflow order and text naturally; blank values stay last in either direction. Stable task-ID ties and copied arrays avoid mutating shared positions.
- Offer local column visibility, status/deadline filters, reset and result counts, combining with workspace search/My tasks. Task title stays visible. New/renamed field definitions reconcile by stable IDs; removed tasks disappear from derived rows. Local settings reset when leaving Table or switching account/workspace.
- Use a native accessible table with keyboard sorting, row/header scopes, announced sort/result state and contained horizontal scrolling. No inline spreadsheet editing, table note blocks, shared table-view settings, extra listeners, dependency or schema change. Browser/mobile/keyboard and two-user acceptance remain open release checks.

### Workspace administrators and direct membership — 2026-10-04

- Keep owner, workspace admin and member distinct. Workspace admins add existing registered accounts directly, manage invitations and remove ordinary members. Owners and root admins appoint/demote admins. Only owners transfer ownership. No self-promotion or owner demotion through role patches.
- Root authority comes from exact server-configured account IDs. Root UI administers access across workspaces without automatic private-content access; no client metadata or workspace role can confer root status.
- Direct addition by email or account ID skips invitation acceptance and never creates or confirms an account. Reauthorize after provider lookup; atomically write membership/account index and private permanent idempotency receipt. Retries after removal cannot resurrect membership.
- Development auto-join uses an explicitly configured existing test workspace and once-only enrollment marker, respects removal/leave, and rejects configuration outside development. Normal email-confirmation policy still applies. Production auto-join is unavailable.
- Root/admin UI reports acknowledgement/failure and keeps uncertain retry identities. Added users explicitly refresh their workspace list or sign in again. Migration 008 documents additive models, Supabase service-only lookup, access checks, export/deletion and deployment. No public user directory or SDK writes.

### Self-hosted website and tracked migrations — 2026-10-04

- Supabase Compose includes a production website container. PORT selects its host port, default 3000; WEB_BIND_ADDRESS defaults to loopback. Website port and public Supabase API URL are separate settings. Auth site/redirect URLs must match the deployed website.
- Browser URL/key are build-time settings; server credentials are runtime-only. Server requests use the private Docker gateway while signed attachment links retain the public API origin. The container runs without root privileges; HTTP health does not imply backend readiness.
- Fresh-install migrations use an administrator-only RLS-protected ledger, normalized checksums, a database advisory lock and atomic migration receipts. Repeated/concurrent runs skip applied files; failed migrations roll back and remain retryable. Refuse existing untracked schemas rather than guessing an upgrade baseline.
- Document first setup, explicit manual upgrades for previously installed schemas, policy publication, backups and hourly cleanup. Provisioning and live migration remain administrator actions; no existing data is moved between providers.

### Linked board views and synced content — 2026-10-04

- User chose both features within the existing workspace. Board embeds persist independent names, query/status/assignee/deadline filters and position/title/deadline sorting. Viewer-relative assignee filters resolve for the reader. Underlying tasks and their authorization stay shared.
- Synced references contain same-workspace source note/block IDs and empty text. Pick saved text-like blocks with stable IDs; edit the original through its existing collaboration controller, journal, trusted updates and generation fences. Share a controller between copies of the same source in an open destination and reuse the current note controller for self-links. Preserve unrelated blocks and reject unavailable sources.
- Never recursively render references. Missing, deleted or unsupported sources remain explicit unavailable links. Removing a destination leaves original content/tasks intact. Make independent copies current source content under the destination identity. Bound each page to 100 links from 20 source notes.
- Preserve composition/failed text, including when a remote edit removes the link; show download/discard recovery. Guard local structural changes, navigation and restore while linked edits are unfinished. Preview source saves use revisions; self-link drafts preserve other local blocks and reject conflicting source changes.
- History/export store references and view settings without resolving current source text. Restoring a destination does not revert source content or tasks. Migration 010 documents additive existing JSON models, access controls, deletion/export and paired client/API rollout. No additional dependency, table, retention policy or SQL step. DOM/IME/mobile/two-user acceptance remains a release gate.
