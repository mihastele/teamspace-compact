# Editable task pages and templates

Requested 2026-10-18. This feature takes priority over further M4 agent work.
User selected explicit Save with conflict protection. The implementation is verified locally; live migration/deployment and authenticated two-user acceptance remain open.

## Intended experience

- Open a Kanban card or table entry as a spacious task page with its title,
  configurable properties and editable block body. Keep the same task identity,
  comments, attachments and links across Board, Table, Calendar and saved views.
- Expose property management from task pages, including select/multi-select
  options, using existing definitions and provider capabilities.
- Create and edit workspace-shared task templates containing a block body and
  default property values. Applying a template creates independent content;
  later template edits do not rewrite existing tasks.
- Preserve existing plain-text descriptions without interpreting their contents
  as Markdown or losing line breaks. Existing descriptions remain readable by
  search, exports and agent tools through a documented compatibility projection.
- Extend the existing workspace task collection. Independent user-defined
  databases and a general page/database unification remain separate scope.

## Editing decision resolved

1. Recommended first delivery: explicit Save with reviewed task revisions,
   recoverable drafts and idempotent retries. Store validated blocks on the task
   record, reuse the note editor and reject concurrent stale saves visibly.
2. Live simultaneous editing: adapt the note CRDT/controller/journal lifecycle
   for task bodies, including generation fences, recovery, authorization,
   initialization, deletion and synchronization tests. Do not silently attach a
   hidden note with a separate lifetime to a task.

The user explicitly chose option 1. Live CRDT task editing remains separate future scope.

## Implementation and verification requirements

- Read installed Next guides before UI/route changes; reuse existing packages.
- Maintain model/runtime validation, selective task updates, task detail DTOs,
  provider snapshots/query results, preview persistence and compatibility text
  together. Rich bodies must survive every read/save/export route.
- Add numbered migration documentation and any necessary SQL/RLS and Firestore
  rule changes. Run migrations from scratch and populated upgrade fixtures;
  preserve existing task IDs and property/option identities. Never edit a live
  database by hand.
- Template reads/writes inherit workspace authorization; validate current field,
  option, member and Project references on application. Bound content and template
  counts; use revision checks, rate limits and idempotent operations.
- Define template export/deletion before merging: include saved definitions in
  board export; deleting a template leaves existing task copies intact; workspace
  deletion removes templates. Do not copy conversations or attachments.
- Expose only supported block actions. Embedded boards must reuse shared task
  data; synced content must retain its existing explicit source authorization.
  Do not expose dead subpage/synced/board commands without functional integration.
- Verify legacy description preservation, rich-block validation and persistence,
  concurrent edits, response-loss retries, deleted tasks, foreign/archived field
  references, template copy independence, provider gates and access control.
- Run relevant unit/backend/rules tests, lint, build and sequential typecheck.
  Verify actual task/editor/template/property interaction and responsive layouts
  in browser; log any remaining acceptance gaps explicitly.
- Update README/SPEC/work queue and append continuity evidence. Commit and push
  coherent verified implementation under standing authorization; no live
  migration/deployment is inferred.

## Investigation evidence

TaskDialog in src/app/page.tsx currently edits description in a textarea.
BlockEditor already accepts controlled NoteContent and optional capabilities.
task-service.ts already provides expectedRevision and operationId handling;
client.saveTask currently forwards neither, so UI adoption requires client work.
Firebase/local preview retain four property types; PostgreSQL supports ten.
Implementation evidence and remaining acceptance gaps are recorded in PROJECT-STATE.md, BROWSER-ACCEPTANCE.md and migrations/015-task-pages-templates.md.
