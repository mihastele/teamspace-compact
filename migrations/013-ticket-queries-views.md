# 013 — Composable ticket queries and persistent views

Apply `013-ticket-queries-views.sql` after 012, with an administrative SQL
connection. The tracked migration runner includes it. Back up the database and
deploy the paired API/client after the migration. No build applies a live
migration. Firebase keeps its current functionality; these endpoints and controls
require PostgreSQL.

## Schema, access, export and deletion

`teamspace_saved_views` stores a versioned query, layout, grouping, visible column
IDs, revision, archive state and server creation/update metadata. Views inherit
workspace membership. The compatibility view/store writer routes `savedViews`
records to this canonical table; no second writable document copy is allowed.
Existing notes, their independent BoardView settings and canonical tasks/fields
are unchanged. An optional `boardView.savedViewId` references the shared view from
the existing `/kanban` block. Clearing that reference restores its independent
settings; deleting a note never deletes its view or tasks. History/Markdown retain
the reference, rather than freezing a second copy of the shared view's settings.

The new table has RLS and workspace-root cascade deletion, like migration 012's
canonical tables. Authenticated members get SELECT under the existing confirmation
policy. Anonymous reads and direct authenticated/service-role writes are denied.
Only service-only store RPCs write. The private indexed-query/context RPCs are not
executable by anonymous/authenticated SDK clients. Realtime changes invalidate the
existing authorized workspace snapshots.

Board JSON includes saved view definitions as well as Projects/tasks/fields.
The Views export includes the applied configuration, Project context and **loaded
rows only**, with `moreAvailable` reporting incomplete paging. Full account or
workspace export/deletion UI remains separate open work. Views can be reversibly
archived; hard deletion is not exposed. Workspace cleanup/root deletion removes
the table's rows. They have no content TTL; future agent full-content audits retain
their separately approved policy.

TypeScript schema types/validators are maintained in `src/lib/ticket-query.ts`;
this repository has no generated ORM client types. A rollback needs a reviewed
reverse migration or backup restore with writers stopped. Do not drop view data
or replay old migrations to roll back. Old clients reject the new optional saved
view reference, so deploy API/client together.

## API and query contract

- `POST /workspaces/:w/tasks/query`: `{query, limit?, cursor?, projectId?}`.
  Returns current task rows, `nextCursor`, query version, field schema revisions
  and timezone. Limit 1–100 (default 50), at most three sorts, 32 filter nodes, 512 comparison values and
  four nested groups. Unknown keys/fields/operators/options are rejected.
- `GET /workspaces/:w/views` and `GET /views/:id`: workspace-authorized definitions.
- `POST /views`: `{config, operationId?}` creates a shared view. An operation UUID
  binds retries to actor/workspace/config; changed intent conflicts.
- `PATCH /views/:id`: `{config?, expectedRevision, archived?}`. Revision conflicts
  preserve the caller's settings. Maximum 64 views including archived views.
- `POST /views/seed`: `{}` creates missing stable default IDs once. It never
  replaces customized or archived defaults. No task data is seeded or duplicated.

Example:

```json
{
  "query": {
    "version": 1,
    "timeZone": "Europe/Ljubljana",
    "filter": {
      "and": [
        { "field": "assigneeId", "op": "eq", "value": "@me" },
        { "field": "status", "op": "neq", "value": "done" },
        { "field": "dueDate", "op": "between", "value": ["@today", "@today+7"] }
      ]
    },
    "sort": [{ "field": "dueDate", "direction": "asc" }]
  },
  "limit": 50
}
```

Groups are `{and:[...]}` or `{or:[...]}`; empty AND matches all and empty OR
matches none. Leaves use `{field, op, value?}`. Custom fields use `custom:<UUID>`.
Built-ins are title, description, status, priority, assigneeId, projectId, dueDate,
estimate and position. Columns use the same identifiers.

All types support `isEmpty`/`isNotEmpty`. Scalar types support `eq`/`neq`; text,
long text and URL add literal `contains`/`notContains`; select/person/relation/
status/priority add `in`/`notIn`; multi-select uses `containsAny`/`containsAll`;
dates add strict `before`/`after` and inclusive `between`; numbers add `gt`/`lt`.
Option IDs must belong to the actual field. Archived options remain searchable.

Missing/null values, empty strings and zero-choice multi-selects are empty.
Numeric zero and checkbox false are nonempty. Negative comparisons are the
complement of positive comparisons, so missing values also match negatives.
Text comparisons/search are case-insensitive literal operations: `%`, `_` and
quotes have no wildcard/SQL meaning. Text sorting uses PostgreSQL lowercase with
deterministic C collation, not the older local table's natural-text ordering.
Numbers sort numerically, status/priority by workflow rank, and person/Project/
single-select by current labels. Blank/null sort values stay last in both
directions; task ID is the final stable tie. Multi-select sorting is not offered.
Legacy missing priority behaves as `none`.

Each view stores an explicit IANA timezone; default views start in UTC and can be
edited. `@me` resolves to the authenticated viewer in person fields. `@project`
requires explicit selected Project context for the built-in Project field.
Date tokens `@today` and `@today+N`/`@today-N` use calendar dates in the view's
timezone (bounded three-digit offsets). Token-like text stays literal. This week
is today through today + 7 inclusive (eight calendar dates); the older local board
filter retains today through today + 6 and completed-work exclusions. This week
includes completed tasks; Overdue and My open work explicitly exclude done.

## Indexed execution and paging

The authenticated service validates field definitions, compiles an allowlisted
AST into static SQL expressions, and binds IDs/values/cursor keys through one
JSON parameter bag using PostgreSQL `EXECUTE ... USING`. The private transport
RPC accepts **trusted compiler output only**; HTTP/model payloads cannot pass SQL,
actor IDs or policy flags through it. Do not expose it as an agent tool or browser
RPC. Agent searches must call the same AST service.

Queries address canonical task rows and typed value/selection tables, bypassing
the full-workspace compatibility snapshot. Positive custom predicates use EXISTS
joins so typed indexes can drive selection. Hydrated custom values are returned
only for page rows. The planner regression uses 3,000 fixtures and verifies the
Project and numeric-field indexes without disabling sequential scans. Broad
text contains and arbitrary sorts can still require scans/sorts; this is not an
unlimited-workspace performance guarantee.

Context/execute reads check workspace membership, published authentication policy
and verified state under the existing epoch lock. A schema/membership/policy
change between compilation and execution retries or rejects before returning
data. Keyset cursors bind workspace, viewer, resolved query, schema revisions and
last sort keys. Invalid/mismatched cursors fail explicitly. Cursors allow up to 300 KB to preserve
long-text sort keys; the existing 600 KB request-body limit also applies. Changing a definition
or crossing a relative-date boundary requires restarting paging.

Pages read current data, not a frozen transaction across HTTP requests. Concurrent
changes to sort/filter values can move rows across a cursor; refresh for a new
coherent first page. The UI deduplicates loaded IDs and displays loaded counts,
not total workspace counts. It refreshes after task/schema changes, on visibility
and once a minute. Board moves optimistically overlay only status/priority, use
existing mutation services, and reconcile against the authoritative query.

## Interface and verification boundaries

Views provides the recursive builder, three sort keys, visible fields, status/
priority grouping, board/table/list layouts, create/edit/archive/restore and
default seeding. Board movement includes accessible selectors and drag/drop.
Workspace/view/Project/task IDs and validated local override settings persist in
URLs. Invalid overrides and unavailable shared references fail closed. Task links
reuse the existing dialog and Project links reuse the existing Project UI.

Automated tests cover validators/compiler injection resistance, timezone/DST/token
semantics, keysets/nulls/sort ties, real typed filters, view retries/revisions/
defaults, RLS/permissions, stale epoch/revocation/policy checks, usable indexes and
populated 012-to-013 preservation. Generated override URLs are bounded to 7,000 characters; larger settings can be
saved and shared by view ID. Saved-view URLs resolve current shared definitions
unless explicit local overrides are present. Actual browser drag/focus/URL/filter behavior,
two-user saved-view propagation, full-stack upgrade and production query capacity
remain acceptance gates. No live installation was changed during implementation.
