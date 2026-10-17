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
  is recorded for the future agent implementation; no audit worker/table exists yet.

## Progress

| Stage | State | Evidence / next action |
| --- | --- | --- |
| M0 architecture scope | Accepted, including lifecycle policies | PostgreSQL-focused expansion; Firebase baseline retained. User approved 30-day configurable full agent audits and inherited Project access/reversible archiving. |
| M1a route and services | Implemented; verification recorded in PROJECT-STATE.md | Export PUT; extract membership/rate-limit helpers, Task/Property mutation services and Conversation read/write services; add authorized task-detail read. |
| M1b task durability/query contracts | Mutation contracts implemented; indexed queries remain planned | Task operation IDs, minimal private receipts and reviewed revisions added in migration 011. Existing UI does not yet persist retry packets. Bounded indexed queries are coordinated with canonical PostgreSQL storage/query migrations; no agent writes before confirmation/audit services exist. |
| M2 projects/normalized fields | Planned | Preserve task/option IDs, adapt parent relations/snapshots/cleanup, implement the approved project lifecycle and cut over to one canonical task/field source. No new SQL tables/migrations have been applied. |
| M3 composable queries/saved views | Planned | One validated query language, server evaluation, persisted layouts/groups/columns and shared view references. |
| M4 read-only agent/worker | Planned | Provider/tool boundary, durable queue/checkpoints, provenance, scoped reads and agreed audit policy. |
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
conventions. They are distinct from the future agent audit's approved default
30-day content retention. See [migration 011](../migrations/011-task-durability.md)
for full shape, access, export/deletion and rollout details.
