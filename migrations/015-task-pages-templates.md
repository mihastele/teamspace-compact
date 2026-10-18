# 015 — Save-based task pages and shared task templates

Task pages now use the existing block editor with explicit Save and reviewed task
revisions. No hidden note or second task identity is created. Comments, attachments,
Project links and Board/Table/Calendar/saved-view references retain their existing
task IDs and lifetimes. No live migration is performed by development or tests.

## Data and compatibility

- Optional `Task.content` contains validated `NoteContent`: paragraph, headings
  H1–H6, bullet/numbered lists, checklists, quotes, code, dividers and Markdown.
  The existing 1,000-block, 20,000-character-per-block and 100,000-character-total
  limits apply. Board embeds, synced references and subpages stay in notes for
  this delivery; the task editor does not offer nonfunctional commands.
- Legacy descriptions open as literal paragraphs, preserving newlines and
  Markdown-like prefixes. No backfill or lossy Markdown interpretation occurs.
- A rich body's `description` is a server-derived first-10,000-character text
  excerpt for existing cards, filters, search and agent tools. Full content remains
  in `content` and the board JSON export. This excerpt is not full-body indexing.
- Editing `content`, or replacing `description` on an existing rich task, requires
  `expectedRevision`. A reviewed description-only replacement intentionally turns
  the body into a literal paragraph. Unreviewed legacy writers cannot erase it.
  Status-only moves remain selective and advance task revisions.
- Workspace collection `taskTemplates/{uuid}` stores `name`, typed `defaults`
  (title/body and default properties), revision, archive state and last-save
  acknowledgement metadata. Revision-checked PUT supports exact immediate retries.
  Definitions are capped at 64 per workspace, including archived entries; updates
  and archives serialize through the workspace record. Writes are limited to 30
  per user per minute. Existing definitions can be edited and reused at the cap.
- Applying a template copies its blocks with new UUIDs and independent property
  arrays into a new task draft. Template edits/archives never alter saved tasks.
  Current field/options/member/Project/scope checks run before UI application and
  again on the trusted task write. Stale defaults can remain in a saved template
  for review, but cannot bypass task validation. Templates copy no attachments or
  conversations and do not supply authority or task IDs.

## Access, export and deletion

All current workspace members can read/manage templates, as with board properties.
Trusted routes reauthorize membership and validate payloads/revisions; browser SDK
writes remain denied. Firestore adds a member-read/server-write-only collection
rule. SQL 015 extends the existing confirmation/member RLS helper for template
records in `teamspace_documents`; RLS stays enabled on that table, store state and
canonical tasks. There is no new SQL table. Existing Realtime document invalidation
and snapshots deliver template changes.

Board JSON version 4 exports task bodies and template definitions/defaults,
including archived templates. Task deletion removes its body and custom values;
archiving a template preserves its content and allows restoration. SQL workspace
prefix cleanup removes templates, and a new root-delete trigger also removes them
if only the workspace root row is deleted. Firestore workspace deletion must use
recursive deletion, like other workspace subcollections. No new account/workspace
deletion UI or attachment cleanup guarantee is claimed.

Device-local task drafts are scoped to account/workspace/task and retain exact
uncertain save packets. Web Locks allow one draft writer per scope; waiting tabs
reload recovery/current task data when ownership transfers. Save persists its
packet before sending. Server UUID receipts prevent duplicate creates/updates;
accepted preview receipts retain hashes and task IDs, not body copies. Review of a
newer revision rebases only the user's edited fields and body over that explicitly
reviewed task. Another concurrent change still conflicts. Download task draft
provides JSON recovery; clearing browser storage removes device-local recovery.
Browsers without Web Locks keep task editing read-only. Local preview reloads the
latest persisted tasks at task save/read/status boundaries; it is not a shared
backend or simultaneous editing mode.

## Rollout and rollback

1. Back up the installation and review all previously unapplied migrations.
2. Apply tracked SQL migrations through 015 with the normal runner, or deploy the
   Firestore rules for a Firebase installation. No schema changes by hand.
3. Deploy the matching client/API together. Models/validators are maintained
   TypeScript contracts; there is no ORM schema generator.
4. Verify authenticated two-user task conflicts, template propagation and exports
   against the actual installation. Isolated database tests and local browser
   checks are not deployed acceptance.

Rolling back the client alone hides rich bodies/templates and risks use of older
description-only writers; keep the new API revision guard while rolling back UI.
Do not remove stored content or reverse an applied migration/checksum to downgrade.

Clean tracked migration, populated upgrade preservation, RLS/SDK denial and root
deletion are covered by isolated PostgreSQL fixtures. Both trusted API providers
exercise rich bodies, stale revisions, exact replay, template copies and access.
