# 011 — Task revisions and retry-safe mutation receipts

Additive document schema on both existing stores; no new SQL table, index, or
backfill. Apply the matching API before clients/tools send the optional controls.
Existing clients can continue selective task patches without these controls.
The PostgreSQL canonical-schema work remains a separate later migration.

## Record and request shapes

- Task `revision`: nonnegative safe integer. Legacy missing/null values read as
  revision 0; new tasks start at 1. Every successful task patch increments it,
  including a membership removal that clears the assignee. A failed/replayed
  mutation does not advance revision. Deleting tasks remain fenced/unavailable.
- Task create/update requests may include `operationId` (UUID v4). Updates may
  include `expectedRevision`; creates reject it. These are control fields, not
  editable/stored task properties. Author/timestamps/revision remain server-owned.
- A reviewed update requires an exact current revision. A stale request returns
  409 `revision_conflict` without creating a receipt or changing any task values.
  Callers that require reviewed-write semantics must supply the revision; legacy
  UI patches retain selective last-commit behavior until its review flow exists.
- `workspaces/{workspaceId}/taskOperations/{sha256(uid:operationId)}` contains
  only uid, taskId, canonical payload digest, applied revision and createdAt.
  Canonical hashing sorts object keys and preserves array order. Digests bind
  mutation kind, target, reviewed revision and validated task input.
- Creates with an operation ID choose `t_{receiptId}` as their task ID. Membership,
  receipt check, assignee/field validation, task write and receipt creation happen
  in one transaction. Concurrent delivery commits one task/receipt. Existing task
  IDs are unchanged; creates without an operation ID retain the legacy path.
- Replays reauthorize membership, match the original payload and return the
  current task without reapplying old values or changing timestamps. A mismatched
  operation returns 409 `operation_conflict`. If the accepted task was removed
  or is deleting, replay returns 409 `task_removed`, never recreating it.

## Authorization, lifecycle and rollout

Task reads remain workspace-member-only. Receipts are server-private under the
existing default-deny rules/RLS; do not grant browser read/write access. Trusted
transactions still use the existing confirmation-policy guard and membership
checks. Neither root status alone nor a known operation ID grants task access.
Underlying PostgreSQL document/state tables keep their existing RLS policies.

Receipts intentionally survive task deletion and have no TTL, following the
existing permanent operation-receipt convention. They contain no title,
description, custom-field values or provider credentials. Keep the small identity/
digest record for the workspace lifetime to prevent delayed replay resurrection;
include operational metadata in authorized administrator exports and remove it
with the workspace. The full workspace/account export/deletion product flow is
still the separately tracked open feature. Full agent audit text is **not** stored
here: its approved configurable 30-day retention applies to the future agent
audit records, not these minimal duplicate-prevention markers.

Maintained TypeScript schema is updated in `model.ts` (optional Task revision) and
server validators. There is no generated per-document ORM schema. Clean isolated
Firestore/PostgreSQL integration fixtures exercise the additive records on the
existing schema; SDK denial/RLS checks include receipts.

Deploy client/API changes together when enabling guarded retries. Do not roll the
API back to a version that writes tasks without advancing revisions after any
client starts relying on reviewed revisions. A coordinated rollback must disable
those clients/tools first; retain tasks and receipts rather than stripping them.
The current UI has not yet adopted durable task mutation packets; these are API
contracts for the upcoming reviewed/agent flows, not a claim of task-form recovery
across browser refreshes.
