# Agentic projects/tickets implementation

Started 2026-10-17 after approval of the recommendation in
[the repository audit](AGENTIC-TICKETS-AUDIT.md).

## Scope

- New feature development targets self-hosted Supabase/PostgreSQL. Preserve the
  existing Firebase feature set and existing Task identities.
- Reuse the Next web/API application and add a separate durable agent worker.
  This is the recommended initial deployment topology, an explicit departure
  from the ticket's separate application API container.
- Approved Project policy: inherit workspace access; support reversible archiving,
  preserving linked tickets; archived projects reject new ticket assignments.
- Approved agent audit policy: configurable 30-day default for full prompts,
  outputs and before/after content; access for the initiating user and workspace
  administrators, authorized exports, deletion with the workspace. This policy
  is implemented internally by migration 014; live upgrade, worker and UI remain ahead.

## Progress

| Stage | State | Evidence / next action |
| --- | --- | --- |
| M0 architecture scope | Accepted, including lifecycle policies | PostgreSQL-focused expansion; Firebase baseline retained. User approved 30-day configurable full agent audits and inherited Project access/reversible archiving. |
| M1a route and services | Implemented; verification recorded in PROJECT-STATE.md | Export PUT; extract membership/rate-limit helpers, Task/Property mutation services and Conversation read/write services; add authorized task-detail read. |
| M1b task durability/query contracts | Mutation contracts and M3 indexed queries implemented | Task operation IDs, minimal private receipts and reviewed revisions added in migration 011. Existing UI does not yet persist retry packets. Migration 013 adds bounded indexed AST queries; no agent writes before confirmation/audit services exist. |
| M2 projects/normalized fields | Implemented; verification recorded in PROJECT-STATE.md | Migration 012 canonical cutover, inherited Project access/archive, ten normalized field types, typed values/options/selections, UI and snapshot invalidation. Clean/populated isolated upgrade verified; no live installation migrated. |
| M3 composable queries/saved views | Implemented; verification recorded in PROJECT-STATE.md | Migration 013, bounded typed AST/compiler/keysets, shared revision-checked board/table/list definitions, default seeding, recursive builder and saved-view note references. Live migration/browser/two-user acceptance open. |
| M4 read-only agent/worker | In progress: provider/read tools and durable queue/audit storage implemented | [M4a contracts](AGENT-PROVIDER.md) and [migration 014](../migrations/014-agent-queue.md): bounded provider/tools, private run/event/receipt tables, fenced leases/retries, account checks, quotas, cancellation, retention/export/deletion. Worker checkpoint engine, process/Compose wiring and UI remain ahead; not exposed as an agent feature. |
| M5 approved writes/release acceptance | Planned | Approval-bound diffs, transactional idempotency/audits, restart recovery and full Compose/two-user acceptance. |

## M1a contracts and verification boundaries

- The framework route now exports GET/POST/**PUT**/PATCH/DELETE. All use the same
  authenticate/dispatch path. A PUT no longer disappears at the route-export
  boundary before field-definition validation.
- `task-service.ts`: `getTask`, `saveTask`, `saveBoardProperty` return domain data;
  HTTP JSON/status mapping stays in api.ts. `conversation-service.ts` provides
  `getConversation` and `changeConversation`, retaining existing membership,
  author-only deletion, mention validation and idempotent posting behavior.
- `service-context.ts` holds existing transaction membership checks/rate limits
  and the trusted actor type. Services require a server-created actor/store;
  no public tool or endpoint may accept that authority from model/client JSON.
  Worker reauthentication/revocation checks remain M4 work, not a capability
  conferred by importing these functions.
- Task detail GET returns selected task fields plus createdBy/createdAt/updatedAt
  (timestamps in milliseconds when available). Legacy audit values are null.
  It performs no backfill and rechecks membership in the transaction; missing
  and deleting tasks are unavailable.
- `route-boundary.test.cjs` loads the real route source and verifies supported
  method exports, awaited route params and unmodified request forwarding. Both
  real-database API suites now use that same route source, with fixture identity
  injected only at the authentication boundary. They still test real domain
  operations/transactions, not actual provider sign-in.
- Shared task-detail integration cases verify saved audit metadata, outsider
  denial, missing/deleted task rejection and nonmutating legacy reads on both
  backends. Existing field/comment/concurrency tests cover the service extraction.
- `test:http` requires a completed standalone build. It starts and stops its own
  credential-free loopback server, verifies framework OPTIONS advertises PUT and
  PUT reaches the API's configuration guard, with no database mutation. CI runs
  this after build. It does not establish a live authenticated field-save result.

No schema, provider settings, retention policy, attachment lifecycle or client
editor behavior changes in M1a. Future migration numbering remains provisional
until the canonical PostgreSQL schema is implemented. Existing archive/editor/
two-user acceptance and license/dependency release gates remain open.

## M1b mutation contracts

Task POST/PATCH accept an optional UUID `operationId`. PATCH accepts optional
`expectedRevision`; create rejects it. Canonical input hashing binds kind/target/
reviewed revision/validated values; object-key order is normalized. A private
actor/workspace-scoped receipt and task mutation commit together. Replays
reauthorize membership and return current data without reapplying old values.
Deleted/deleting tasks remain unavailable and cannot be recreated by a retry.
Unknown/mismatched operations and stale reviewed writes return explicit conflicts.

New tasks start at revision 1; legacy tasks read as 0. Ordinary patches and
administrative unassignment advance revision, preventing approvals based on
outdated assignments from silently applying later. The existing UI still uses
selective patches; reviewed UI flows and durable task-form recovery remain later
work. Indexed query endpoints remain coupled to the canonical PostgreSQL schema.

Minimal hash/identity/revision receipts contain no ticket text and persist for
workspace-lifetime duplicate prevention, matching existing operation-receipt
conventions. They are distinct from the agent audit's approved default
30-day content retention. See [migration 011](../migrations/011-task-durability.md)
for full shape, access, export/deletion and rollout details.


## M2 canonical records and Projects

See [migration 012](../migrations/012-canonical-projects-fields.md) for schema,
backfill/rollback, RLS, export/deletion and paired rollout instructions. The existing
transactional document interface reads a security-invoker compatibility view;
canonical task JSON excludes custom values. Six member-readable/server-written
relational tables hold Projects, Tasks, definitions, options, typed values and
multi-select joins. Existing IDs and parent references survive atomic cutover.
Core generated columns and custom-value indexes prepare M3; the store still uses
the existing global epoch and small workspace snapshots.

Projects expose authorized create/list/detail/revision-checked edit/archive APIs.
Task assignment and relation changes check active same-workspace Projects in the
transaction. Browser Projects/task/table/forms cover Project links, priority,
estimate, scoped fields, all ten types and option color/order/archive management.
New feature controls are PostgreSQL-only; Firebase's existing four types remain.
The shared realtime channel invalidates snapshots for new tables; periodic polling
continues. Board JSON adds Projects and hydrated canonical fields/values.

M3 below adds nested query/saved-view contracts. M4a's internal provider/read tools
are described in [their contract](AGENT-PROVIDER.md); migration 014 adds M4b's
private queue and audit lifecycle. Durable task-form recovery, worker, tool
confirmation, run UI and live deployment remain future work.
No new dependency, live schema change or deployed acceptance is implied.


## M3 composable queries and persistent views

[Migration 013](../migrations/013-ticket-queries-views.md) documents the versioned
AST, all typed operators, empty/negative/case/date semantics, explicit timezone,
viewer tokens, stable keysets, RLS and export/deletion. Shared saved definitions
persist board/table/list layouts, status/priority grouping, ordered visible fields
and three sorts. Default IDs seed idempotently without overriding existing work.
Create retry identity and reviewed revisions protect shared definition edits.

Views uses a recursive FilterBuilder, apply/save/save-as-new, archive/restore,
loaded-row export and query-backed layouts. Status/priority moves reuse existing
mutation services with a field-only optimistic overlay. Existing note board blocks
optionally reference a shared savedViewId, preserving independent legacy settings;
this reuses the existing block format rather than introducing an executable plugin
runtime. URLs reuse existing Task dialogs and Project UI, with validated bounded
local query overrides. Shared references follow new revisions without rolling an
acknowledged local write back to an older snapshot; local edits remain reviewable.

Queries address canonical indexed rows and typed EXISTS predicates, with all
values bound by the trusted compiler. Private SQL transport is not a model/browser
tool. Membership, confirmation policy and epoch are checked at context/execute;
new agent searches must call this service. Planner tests verify actual Project and
typed-number indexes on 3,000 fixtures. Broad contains/arbitrary sorts may scan;
current pages are live rather than a cross-request frozen snapshot.

The existing app still observes workspace snapshots for older boards/notes and
query invalidation. M3 does not remove the global epoch or establish unlimited
workspace capacity. Browser drag/focus/URL/filter interactions, authenticated
propagation and real migration/Realtime acceptance remain open. Next is M4's
read-only agent/worker and M5's confirmed tools/audits, not arbitrary SQL access.
