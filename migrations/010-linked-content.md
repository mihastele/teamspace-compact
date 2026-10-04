# 010 — Linked board views and synced content references

Additive JSON schema, no new table/collection/index or SQL function. Existing
notes/CRDT/history rows keep their member-read/trusted-write access rules and RLS.
Supabase installs still require migrations 000, 007, 008, 009; 010 has no SQL
step because the transactional JSON store already holds note content. Deploy
the updated trusted validators and client together; older validators/clients
reject the new fields/types. No live database changes or backfill are required.

Maintained types in `src/lib/model.ts` now define:

- Board blocks may have `boardView`: name (1–80 characters), query (0–200),
  status (`all`, `todo`, `doing`, `done`), assignee (`all`, `me`, `unassigned`
  or a same-workspace member ID), deadline (`all`, `overdue`, `today`, `week`,
  `undated`), sort (`position`, `title`, `dueDate`). Legacy board blocks use
  the all-tasks/default-order view. Viewer-relative `me` is resolved locally.
- Synced blocks have `type: synced`, empty text and `source: {noteId, blockId}`.
  IDs are validated path segments/UUIDs; a workspace ID/path cannot be supplied.
  The destination never copies source text. Source data is drawn only from the
  current member's active workspace and its trusted note synchronization routes.
- Settings/targets are part of the existing atomic Yjs format register, preventing
  partial concurrent settings. Plain source text retains existing Y.Text merging.
- A page permits 100 synced references from at most 20 distinct source notes.
  Each currently open destination shares one controller/journal per source note;
  its own source uses the already-open controller. Pending source controllers are
  retained within the open page, including after remote link removal.

Sources are saved text-like blocks (paragraph/headings/lists/todos/quotes/code/
Markdown), with stable IDs assigned during collaboration preparation or preview
Save. Boards, dividers and synced references cannot render as sources: the renderer
does not recursively traverse references, so dangling/cyclic targets show unavailable
rather than causing recursion or fetching another workspace. Target syntax is
validated server-side; existence is intentionally not required on every save or
restore, so deleted sources never prevent unrelated destination edits.

Editing from a linked location edits the original note, with existing member
authorization, bounded checkpoints, durable journals, generation fences and retry
receipts. Unfinished composition/failed local text is preserved visibly; pending
source recovery remains downloadable. Structural link removal/conversion waits
for local composition and pending source synchronization. Make independent copies
the current source block under the destination ID and removes the reference.
Local preview uses revision-checked source saves; self-links remain part of the
current explicit-save draft. Browser interaction acceptance remains required.

Deleting a reference/page leaves source content and board tasks intact. Deleting
the original block/note makes links unavailable; they are retained, not cascaded.
Source-note history captures source edits. Destination history captures references
and board settings only; restoring it never restores/reverts linked source text or
task data. A restored original block with the same ID becomes visible to links again.
Markdown exports include reference IDs and view settings, not dereferenced current
content. Source notes can be exported separately; source recovery downloads include
their full pending content. No new retention or automated deletion policy.

Rollback both client and server together, preserving stored references/settings
and collaboration state for future upgrade. Do not strip new JSON fields or replace
CRDT generations to make an old client accept the document. Full workspace/account
export/deletion remains the existing open feature.
