# 002 — Workspace note hierarchy

Date: 2026-10-03. Additive schema change; no live database changes performed.

## Stored fields and compatibility

- `workspaces/{workspaceId}/notes/{noteId}` gains `parentId: string | null`.
  A missing field on an existing note means a root note, exactly like `null`.
  New notes explicitly store `null` unless a parent is supplied. Saves normalize
  legacy notes to an explicit value. No backfill or destructive transformation is needed.
- `workspaces/{workspaceId}` gains `noteTreeRevision`, a server-maintained counter.
  A missing counter is initialized by the first atomic increment. It serializes
  note creation, parent changes, and both phases of note deletion in transactions.
  It is independent of individual note revisions and does not change edit permissions.
- The maintained TypeScript Note model includes `parentId`; Firestore does not
  generate schema types. Parent-child lookup uses Firestore's built-in single-field
  `parentId` index; no new compound index or dependency is required.

## Save and move behavior

The existing explicit Save endpoint accepts an optional `parentId` on POST and
PATCH. An omitted PATCH field preserves the existing parent; `null` moves to the
workspace root. A parent identifier is always resolved within the active workspace.
The server rejects nonexistent/deleting parents, self-parenting, descendant moves,
and corrupt ancestor cycles before writing. It reads the complete ancestry in the
same transaction as the structural counter, so concurrent reciprocal moves cannot
introduce a cycle. There is no application-imposed nesting depth cap; exceptionally
large chains are subject to Firestore transaction size/deadline limits and fail
without partial mutations.

Every save still checks `expectedRevision` and increments the note revision,
including parent changes. A conflicting save receives `409 revision_conflict`;
the server never overwrites the losing draft. The client retains that draft and
offers the existing copy/reload workflow.

## Deletion and data safety

Deleting a note with any direct children receives `409 note_has_children` before
setting deleting flags or touching attachment bytes. The user must move or delete
children explicitly. No descendants cascade-delete. The child query and structural
counter update share a transaction with deletion's first phase. Creates and moves
read the same counter and reject a parent marked deleting, preventing orphaning
under concurrent create/move/delete operations. Existing attachment cleanup and
retryable deletion semantics continue to apply to child-free notes.

Workspace exports include each note's `parentId`, interpreting legacy missing fields
as root. Restore parents within the same exported workspace and verify the tree
before exposing restored content. Operator account/workspace deletion policy from
migration 001 remains unchanged; deleting an entire workspace intentionally removes
all its notes through the existing operator workflow.

## Access control and verification

Every level inherits workspace membership. There is no page-level privacy or
permission override. Existing default-deny Firestore rules allow member reads and
deny all browser writes to notes and workspace counters; trusted server handlers
repeat membership authorization inside each mutation transaction. Storage rules
remain default-deny with authorized short-lived downloads.

Run the clean emulator suite with `npm run test:rules` and the application typecheck.
The trusted API fixtures cover legacy roots, roots/children/deeper levels, shared
member saves, workspace isolation, self/descendant/corrupt cycles, concurrent
reciprocal moves, create/move versus deletion, revision conflicts on moves, and
child-preserving deletion with untouched attachment bytes. This migration is
deployment metadata, not a claim that production configuration is available.
