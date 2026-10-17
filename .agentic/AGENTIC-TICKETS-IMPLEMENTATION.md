# Agentic projects/tickets implementation

Started 2026-10-17 after approval of the recommendation in
[the repository audit](AGENTIC-TICKETS-AUDIT.md).

## Scope

- New feature development targets self-hosted Supabase/PostgreSQL. Preserve the
  existing Firebase feature set and existing Task identities.
- Reuse the Next web/API application and add a separate durable agent worker.
  This is the recommended initial deployment topology, an explicit departure
  from the ticket's separate application API container.
- Inherited workspace access is recommended for Projects. A policy question is
  pending on reversible project archiving and disallowing new tickets on archived
  projects. Agent audit retention/export/deletion is also pending. No schema or
  retention behavior is being selected silently while those questions are open.

## Progress

| Stage | State | Evidence / next action |
| --- | --- | --- |
| M0 architecture scope | Backend/topology recommendation accepted; lifecycle policies pending | PostgreSQL-focused expansion; existing Firebase features retained. Policy questions sent before dependent storage work. |
| M1a route and services | Implemented; verification recorded in PROJECT-STATE.md | Export PUT; extract membership/rate-limit helpers, Task/Property mutation services and Conversation read/write services; add authorized task-detail read. |
| M1b task durability/query contracts | Planned | Idempotent creates and reviewed-revision updates remain unimplemented. Bounded indexed task queries are coordinated with canonical PostgreSQL storage/query migrations. Do not expose agent writes before these contracts and approvals exist. |
| M2 projects/normalized fields | Planned | Preserve task/option IDs, adapt parent relations/snapshots/cleanup, define project lifecycle and cut over to one canonical task/field source. No new tables/migrations have been applied. |
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
