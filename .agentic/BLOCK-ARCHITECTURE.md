# Unified block architecture proposal

2026-10-29. Proposal for discussion; this is not an implemented schema or an assertion about Notion's internal implementation. Supabase/PostgreSQL is the active development target; Firebase remains in the repository but is not currently in development.

## Why change

The current model stores a flat array of content blocks inside each note, task or database entry. Notes have a separate parent tree; synced content identifies a source note and block; database links connect only database entries. Notes use a per-note Yjs document. These different boundaries make nesting, moving and referencing content consistently across entity types difficult.

## Proposed model

- Give every block a durable, workspace-scoped identity and a type with validated, type-specific data. Pages and database entries are block entities that can contain content. Specialized task, project and database behavior can be backed by typed records attached to block identities rather than forcing all attributes into untyped text.
- Model containment explicitly: at most one parent per block, an ordered sequence of children, workspace consistency and cycle prevention. Moving a block preserves its identity and descendants. A workspace root or an equivalent explicit root owns top-level entities.
- Model references separately from containment. References identify source and target blocks and their kind; database relation fields define which target collection is allowed. Backlinks are derived from indexed relationships. A synced presentation must have one authoritative source and defined unavailable/deleted behavior.
- A database defines a collection and typed properties; its entries are page-like blocks. Views are saved query and presentation definitions over those entries, not copied data. Existing boards and task workflows should map onto this model only after their semantics are specified.
- Workspace membership is enforced server-side and by PostgreSQL access controls. Define export and deletion for blocks, edges, attachments, history and collaboration state together. Deletion must not silently destroy independently owned referenced content.

## Decisions before implementation

1. **Collaboration boundary:** compare per-page Yjs documents, independent block documents, and another bounded partition. Specify cross-boundary moves, concurrent edits, offline recovery, identity, retries, tombstones and authorization; demonstrate how no accepted edit is lost.
2. **Existing data:** decide whether to migrate existing staging workspaces or reset a specifically identified environment after backup. Not being in production does not establish that its data is disposable. Preserve or explicitly replace history, attachments, links and local drafts according to the decision.
3. **Tasks and projects:** define how existing lifecycle, board properties, saved views, permissions and agent audit references map to block identities. Avoid assuming every domain record must itself be a content block.
4. **Reference and deletion semantics:** define linked versus synced behavior, dangling references, archive, subtree deletion and recovery; reconcile existing page history and restore policy.
5. **Ordering and scale:** select ordering and transaction rules for concurrent inserts and moves, with indexes and bounded queries. Define whether cross-workspace references are excluded.

## Proposed delivery slices

1. Settle the decisions above and document schema, migration, access, export, deletion and collaboration invariants. Validate a small collaboration/move prototype before committing to its storage boundary.
2. Add the PostgreSQL block and relationship foundation with migrations, generated or maintained types, access controls and tests against a clean database. Choose an explicit transition plan for existing data.
3. Connect page editing, nested blocks and moves end to end, including concurrent/offline recovery and accessible UI.
4. Connect databases, typed relations and views; then migrate task/project workflows and remaining references in separately testable increments.

Each slice must leave a usable build and preserve the existing security and recovery guarantees. Full authenticated two-user, mobile, export/deletion and migration acceptance are required before claiming the redesigned product ready. Existing release gates remain open.
