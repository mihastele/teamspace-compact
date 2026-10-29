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

1. **Collaboration boundary:** user approved PostgreSQL as the source of truth for block identities, containment, ordering and references, and per-text-block Yjs state, on 2026-10-29. The detailed production protocol remains to be specified: cross-boundary moves, concurrent edits, offline recovery, identity, retries, tombstones and authorization must protect accepted edits.
2. **Existing data:** user chose to preserve and migrate existing staging workspaces on 2026-10-29. Design and test the transition, including history, attachments, links and local drafts, before any staging changes; back up and verify recovery.
3. **Tasks and projects:** user chose both as page-like block entities with attached typed fields on 2026-10-29. Define how existing lifecycle, board properties, saved views, permissions and agent audit references map to block identities.
4. **Reference and deletion semantics:** define linked versus synced behavior, dangling references, archive, subtree deletion and recovery; reconcile existing page history and restore policy.
5. **Ordering and scale:** select ordering and transaction rules for concurrent inserts and moves, with indexes and bounded queries. Define whether cross-workspace references are excluded.

## Proposed delivery slices

1. Settle the decisions above and document schema, migration, access, export, deletion and collaboration invariants. Validate a small collaboration/move prototype before committing to its storage boundary.
2. Add the PostgreSQL block and relationship foundation with migrations, generated or maintained types, access controls and tests against a clean database. Choose an explicit transition plan for existing data.
3. Connect page editing, nested blocks and moves end to end, including concurrent/offline recovery and accessible UI.
4. Connect databases, typed relations and views; then migrate task/project workflows and remaining references in separately testable increments.

Each slice must leave a usable build and preserve the existing security and recovery guarantees. Full authenticated two-user, mobile, export/deletion and migration acceptance are required before claiming the redesigned product ready. Existing release gates remain open.

## Collaboration experiment

Run `npm run test:prototype:blocks`. This isolated Yjs experiment models location as a separate in-memory mapping keyed by block identity. It checks concurrent text updates with a cross-page move in both delivery orders, delayed dependent updates and duplicate delivery, and separate block contents. It does not implement PostgreSQL, authorization, durable receipts, routing, deletion, editor integration or an offline journal. Its results establish only the demonstrated Yjs behavior; production acceptance requires real transactions and end-to-end tests.

Compared with the current per-page Yjs document, a per-block document can stay stable across moves and isolates editing histories. The cost is more document state, subscriptions, receipts, requests and client lifecycle management; batching and realistic load measurements are needed. A whole-workspace document would simplify identity across moves but increase contention, state size and authorization/recovery blast radius. Per-page documents limit subscriptions but need a carefully fenced cross-document transfer to avoid stranding offline edits. The experiment does not settle these operational tradeoffs.

The production design must explicitly cover atomic structural changes and cycle checks; concurrent moves and sibling ordering; authorization and membership revocation; update dependency validation and durable idempotency; deletion and late edits; offline journals and recovery; history/restore across moved blocks; batching, limits, and resource cleanup. The existing page restore and linked-source guarantees remain in force until a deliberate replacement is agreed.

## Candidate production foundation

The user approved the foundation; the detailed schema is not finalized. PostgreSQL will be authoritative for workspace-scoped block identities, typed content metadata, parent/position and typed reference edges; Yjs checkpoint state will be keyed by the identity of each collaborative text block, independent of its parent. Tasks and projects will have page-like block identities and typed domain records, while database membership and typed properties remain explicit. A move changes containment without rewriting the text checkpoint. Views refer to query definitions and targets, rather than own copies of records.

Every write must pass through trusted membership-checked services; browser access must be constrained by RLS. Structural mutations need atomic cycle prevention, stable ordering, an explicit concurrency contract and a deletion fence. Text updates need a server-computed payload digest, identity and generation checks, schema and dependency validation, bounded checkpoint size, atomic merge and receipt, and reauthorization even for retries. A conflict must never turn an unvalidated or incomplete Yjs update into an acknowledgement. Receipts must be scoped to the authenticated actor and operation and preserved according to an explicit replay policy. The experiment below deliberately does not implement these protections.

Migration must account for the existing per-page Yjs generations: copying rendered text into fresh per-block documents does not automatically preserve the causal history of pending offline updates. A transition therefore needs a tested fence and recovery path for old clients and journals, plus a verified mapping for notes, tasks, projects, database entries, relationships, attachments, conversations and history. Snapshot semantics for restoring content after blocks have moved need a separate decision; the current policy preserves location, children, attachments and board tasks. Existing staging data is to be preserved, and no migration should run there until backup and restore have been verified.

Before adopting the schema, specify block and edge lifecycle, reference deletion behavior, revision and generation rules, authorization, export/deletion, bounded querying and ordering, and a phased migration. Prototype results alone do not validate resource usage or network and two-user behavior.

`src/lib/block-collaboration.ts` is an initial standalone merge primitive for a single plain-text Yjs block. It rejects incomplete updates, extra roots, hidden map entries, embeds, formatting, invalid text and oversized payloads. It does not authenticate, store state, issue receipts, define generations or connect to the editor; a trusted integration must supply those protections and test them end to end.

## PostgreSQL containment experiment

Run `npm run test:prototype:block-structure` with Docker. A disposable PostgreSQL container tests one possible containment transaction: serialize structural changes per workspace, reject cycles and cross-workspace parents, and retain separate content when a block moves. The tests exercise reciprocal concurrent moves using separate PostgreSQL sessions. An additional experiment stores a Yjs checkpoint independently from location, checks optimistic revision conflicts and retries, and verifies two competing edits survive a move and re-merge; a receipt prevents an identical retry from advancing the revision twice and rejects a changed digest. This is an experiment, not a migration or production schema: its structural lock works only if all structure writers use it. It trusts a test-supplied digest and checkpoint, so it does not authenticate, validate Yjs updates, verify dependency completeness, or establish a safe production retry protocol. It also lacks access control, ordering, create/delete races, durable client journals, migration of existing data, and tests of network failures. Workspace-wide serialization may be too costly at scale and requires measurement. No application database is contacted.
