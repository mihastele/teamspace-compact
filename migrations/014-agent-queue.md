# Migration 014 — private agent run queue and audit storage

Apply `014-agent-queue.sql` after 013 through the administrative migration runner
or the documented manual upgrade path. The runner records all six SQL migrations;
never edit previously applied files/checksums. This is an additive migration with
no note/task/field cutover or user-content backfill. Keep a backup and deploy the
matching server/cleanup code together. No live installation was migrated during
implementation. The queue is internal: no model call, run HTTP API, worker process
or agent UI starts merely by migrating or importing the server module.

## Schema and maintained types

| Table | Content | Export | Deletion |
| --- | --- | --- | --- |
| `teamspace_agent_runs` | Prompt, selected saved-note/Project IDs, status, private version-1 worker checkpoint, visible result, error code, attempts, lease, timestamps and fixed expiry | Authorized `export` includes public run fields and checkpoint; ordinary reads exclude checkpoint/lease secrets | Expiry pruning or workspace root deletion |
| `teamspace_agent_events` | Append-only sequence/kind/full JSON payload supplied by the trusted worker; same visibility and expiry as parent | Authorized `read`/`export`, in sequence order | Run FK cascade |
| `teamspace_agent_requests` | Workspace/initiator/operation UUID, content digest, original run UUID and timestamp; no prompt/output | Authorized `export_requests`, keysets of 500 plus next cursor, including receipts for expired runs | Workspace FK cascade; deliberately retained across run expiry |

All three tables have RLS enabled. Run/event SELECT is restricted to a currently
authorized initiator or workspace owner/admin. Ordinary members cannot read
another initiator's run, even if they know its UUID. Root administration grants
no content bypass. A deleted, banned, anonymous or (when required) unconfirmed
account cannot read or execute. Account deletion blocks execution/access but does
not remove the workspace administrators' audit record before expiry. Receipts
are SDK-private and use the same actor/admin scope for their service export.

Browser roles cannot execute the queue RPC or internal helpers. Direct writes
are denied to both authenticated and service-role SDKs. Authenticated SELECT has
column grants excluding checkpoint, lease token/deadline, worker ID and internal
byte counters; authorized explicit export includes checkpoint, never fence keys.
Service-role table access is denied; it uses the security-definer RPC only.
No agent rows are added to the document compatibility view, workspace board
snapshot or shared Realtime stream, which would leak private initiator audits.

`src/lib/server/agent-queue.ts` maintains the TypeScript run, lease, checkpoint,
event, receipt and export contracts. There is no ORM/schema code generator in this
repository. Its DTO mapping selects fields rather than forwarding a widened RPC
response. `supabaseAdmin().agentQueue(required)` constructs this client lazily;
existing web/Firebase operations do not require agent settings or invoke it.

## Creation, authority and limits

Authority comes from the trusted server, never prompt/tool arguments. Every
read/create/export/cancel checks the live workspace, membership, published email
policy and actual Auth account state. Initiator/admin visibility is independent
of worker execution authority. Missing/private/expired run IDs return not found;
an accepted operation replay whose original content expired returns expired.

Create accepts an operation UUID, a 16,000-character prompt and optional selected
same-workspace live saved-note/Project IDs. Archived Projects may be selected for
historical read-only work. It does not embed or expand note content. Canonical
JSONB prompt/context hashing binds retries; changed content conflicts. Same
operation retries return current status, including cancellation, without enqueueing
again. Retention configuration changes do not change an existing retry's identity.

Per-workspace creation serialization enforces at most five active runs per user,
20 per workspace, and ten accepted creates per user/workspace/minute. Failed
validation consumes no retry receipt. Creation quotas deliberately count queued,
running and retrying work; terminal/expired runs do not occupy active slots. The
internal list shows the latest 50 visible runs. For a complete live audit export,
enumerate receipt keysets and export each still-visible run UUID; expired content
stays absent. This is a live export, not a frozen multi-page database snapshot.

## Leases and atomic audit writes

The service-only `teamspace_agent_queue(action,input)` supports create, list,
read, export, export_requests, cancel, claim, heartbeat, checkpoint and prune.
Worker claims use `FOR UPDATE SKIP LOCKED`, available time, a 90-second lease,
rotated random token and monotonically increasing run version. Two workers cannot
claim the same current lease. Claim, heartbeat and checkpoint recheck actual
account/membership/policy. A worker policy mismatch leaves queued work intact;
revoked initiators are terminally failed when a worker next claims eligible work.

Every save requires the current, unexpired token and worker ID, plus the reviewed
run version. Checkpoint, event append, result and status change commit atomically.
Heartbeat extends a valid token without incrementing the checkpoint version or
writing a content event, so it cannot cause a spurious CAS conflict with a save.
Cancel clears the lease and advances the version; it is idempotent for terminal
runs. It does not promise to undo a provider request already in flight.

An expired lease records `lease_expired` with `readMayRepeat: true`, rotates the
token and resumes the last durable checkpoint. Queue storage does not itself
call a provider or infer which unacknowledged output existed in crashed memory.
The future engine must persist model/tool request events before calls, their
selected results after calls, and validate messages/provenance/phases on resume.
Read-only work may repeat after a crash; provider billing cannot be exactly once.
No underlying ticket/comment/Project write tool is available in this stage.

Each run has at most three claims. Retry availability uses server-side exponential
backoff (2, 4 seconds for the first two failures); a third failed retry is terminal.
Three crashed leases also end in `lease_exhausted`. Retrying is caller-directed:
the future worker must use the provider's stable retryability classifications.

Storage caps: 512,000 bytes per checkpoint, 300,000 per event payload, 64,000 per
result, 180 worker-authored events and 7,500,000 worker payload bytes. Additional
reserved space (200 total events/8,000,000 bytes) permits bounded claim/recovery/
failure/cancel events even when the worker exhausts its budget. Completed saves
require an object result. Generic checkpoint JSON must have version 1, but the
queue is not a substitute for the engine's semantic checkpoint validation.
Only the trusted worker may supply checkpoint/events; no model input receives
these queue capabilities. Raw provider errors/keys/reasoning must never be saved.

All queue operations acquire the existing document-state SHARE lock before any
run-row lock; document deletion/membership changes take its UPDATE lock first.
This prevents lock inversion with workspace FK cascades and serializes queue
authorization with document changes. Queue-only updates never advance that
document epoch, avoiding unrelated edit retries. Auth account checks use the
provider's actual database row, including optional banned/deleted/anonymous fields.

## Retention and deployment

`AGENT_AUDIT_RETENTION_DAYS` is a server-only integer from 1 to 365, default 30.
It is applied to **new** runs as an immutable expiry; changing configuration
does not extend or shorten already recorded content. The Compose web runtime
passes it through, without a browser/build setting. It does not enable an agent.

All reads/RLS/exports/claims/saves hide expired content immediately. The existing
operator-scheduled `scripts/prune-supabase.mjs` now also physically deletes expired
runs/events in batches of 500, with a 100-batch invocation budget. If the budget
is reached, rerun cleanup; no content is printed. Minimal retry receipts remain
workspace-private to prevent resurrection and are exportable separately. Deleting
the workspace root cascades all three tables, including receipts; stale workers
cannot recreate them. Scheduling the existing hourly cleanup remains an operator
deployment requirement. If cleanup is offline, content is unreadable after expiry
and physical deletion resumes when cleanup runs. The future worker will also need
startup/periodic pruning; this migration does not create a scheduler.

Fresh tracked migrations and populated 013→014 upgrades are tested in isolated
PostgreSQL. Access/column grants, helpers, exports, expiry, replay, quotas, lease
replacement, retries, account/policy revocation, cancellation and workspace-delete
races are covered by real database tests. RPC tests bridge SQL directly, not live
GoTrue/PostgREST. Worker engine/process restart, HTTP/UI/export downloads, live
provider calls and deployed two-user behavior remain subsequent acceptance work.

Rollback: stop any future producers/workers first and retain/export private audits
according to the approved policy. Older application code ignores these additive
tables. Prefer rolling back application code while retaining schema; do not drop
tables or delete receipts as a routine rollback, which loses retry protection.
