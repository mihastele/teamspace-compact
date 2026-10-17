# Agentic tickets: repository audit and proposed plan

Assessed 2026-10-17 at `012571d`. Scope: the supplied ticket, before application
implementation. This is a source audit, not new deployment acceptance. Existing
test results are recorded in PROJECT-STATE.md; no runtime suite was rerun for
this document. Proposed migrations/contracts below do not exist yet.

## Assessment

The ticket is an extension of Teamspace's existing Task entity, not a new task
application. Reuse task IDs, membership, auth, comments, attachments and the
three existing layouts. Do not create a second Ticket collection alongside Tasks.

Custom **fields** and custom **editor blocks** are different features. Four field
types and eleven built-in block types exist. The supplied ticket adds typed fields,
views and agent workflows; it does not define an arbitrary block/plugin runtime,
third-party integrations, formulas, rollups, timeline or gallery acceptance.

The two largest changes are normalized PostgreSQL storage/querying and a durable,
permission-bound agent worker. Treat them as separate milestones after core
projects/fields/views work. The current Firebase-or-Supabase support contract must
be resolved before choosing an implementation that only works on PostgreSQL.

## Inventory

Paths below are relative to the repository root.

| Area | Classification | Evidence and reuse/extension |
| --- | --- | --- |
| Authentication/users | **exists** | `src/lib/browser-backend.ts`, `src/lib/server/api.ts` (`authenticate`), `src/lib/server/auth-policy.ts`, `src/app/components/AuthPanel.tsx`: Firebase/Supabase email/password and optional Google, server token checks and configurable confirmation policy. Reuse; optional app MFA is unimplemented. |
| Workspaces/roles/permissions | **exists** | `src/lib/model.ts`: Workspace, Member with owner/admin/member. `src/lib/server/access-config.ts`, `registered-accounts.ts`, `api.ts`: root allowlist, membership transactions, invites/direct additions. `WorkspaceAccess.tsx`; `firestore.rules`; SQL 007–009 RLS. Root administration does not confer private-content access. |
| Project permissions | **missing** | No Project model, project membership, or project ACL. Existing content rights are workspace-wide; admin roles primarily govern membership administration. Do not silently turn projects into a new private authorization boundary. |
| Tasks/tickets | **partially exists** | `src/lib/model.ts` Task; `api.ts` `mutateTask`; `src/lib/server/validation.ts` `taskInput`. Title, description, fixed todo/doing/done status, one assignee, due date, position and propertyValues exist. Server stores createdBy/createdAt/updatedAt, but Task DTO/UI omit these audit fields. No first-class priority, estimate, labels, sprint or projectId. Priority/labels can currently be manually modeled as custom selects. |
| Projects and reverse relations | **missing** | No product Project entity, CRUD, project page, or task-to-project relation. Firebase project configuration is unrelated. A note tree or workspace is not a project relation. |
| Persistence/models/ORM | **partially exists** | `src/lib/server/document-store.ts`: native Firestore adapter and Supabase JSON-document adapter. SQL 007 creates `teamspace_documents(path,data jsonb,version,workspace_id,collection)` and `teamspace_store_state`; SQL 000 creates the migration ledger. No ORM or normalized task/field/value tables. Existing collection/workspace indexes do not provide the requested task-field/join indexes. |
| API/service boundary | **partially exists** | `src/app/api/[...path]/route.ts` delegates to `src/lib/server/api.ts`. Trusted validation/authorization/transactions are reusable, but most business operations are private functions in the dispatcher, not a shared service layer callable by a worker. Task list/detail reads currently use subscriptions/workspace snapshot, not paginated query/detail endpoints. |
| Board and drag/drop | **exists** | `src/app/page.tsx` WorkspaceBoard, `src/lib/task-status.ts`, `client.ts` setTaskStatus: native HTML drag/drop and keyboard/touch status select send status-only patches, with pending feedback and retry. Same task data feeds all layouts. No immediate optimistic cross-view card relocation; configured mode waits for shared updates. Grouping is fixed by status; within-column drag ordering is not implemented. |
| Table/calendar | **exists** | `TaskTable.tsx`, `TaskCalendar.tsx`; `src/lib/task-table.ts`, `task-calendar.ts`, `task-deadlines.ts`. Table supports field columns, visibility and sorting; calendar supports month/agenda and date-prefilled task creation. Reuse these components/helpers. Calendar agenda is not a general configurable ticket-list layout. |
| List/timeline/gallery/sprints | **missing** | No dedicated generic list, timeline, gallery, Sprint entity or sprint relation. Only list is mandatory in this ticket; a sprint view requires a sprint field/model rather than a UI name alone. |
| Filters/sorting/grouping | **partially exists** | `linked-content.ts` linkedBoardTasks and `task-deadlines.ts`: text/status/assignee/deadline filters, combined with AND, plus limited sorting. Table settings are component state. No nested AND/OR expression, custom-field predicates, general grouping, stable paginated server queries, or URL-persisted view state. |
| Saved views | **partially exists** | `model.ts` BoardView; `LinkedBoardSettings.tsx`: board-block name/query/status/assignee/deadline/sort persist inside note/CRDT content. This is not a workspace-level reusable SavedView entity. No saved table/list layout, visible-field persistence or view CRUD. |
| Built-in blocks/synced content | **partially exists** | `model.ts` NoteBlock, `BlockEditor.tsx`, `SyncedContent.tsx`, `MarkdownText.tsx`, `collaboration-model.ts`, `linked-content.ts`: paragraph/heading/bullet/ordered/quote/todo/code/divider/markdown/board/synced. Slash/type menus, independent linked board settings and editable same-workspace references exist. Closed validated types; no user-defined block schema, plugin code execution, or general saved-view/table/list block. |
| Comments/mentions | **exists** | `Conversation.tsx`, `ConversationBody.tsx`, `src/lib/conversations.ts`; task/note comments under their parents in `api.ts`. Idempotent posting, author deletion, safe mentions and latest-50 window. Reuse for Tickets; older pagination, notifications, block comments and Project conversations are absent. |
| History/activity/auditing | **partially exists** | `PageHistory.tsx`, `page-history.ts`, migrations 004–006: note versions/restore and collaboration/comment receipts. Creation/update metadata exists for tasks. No general immutable ticket activity stream or agent run/tool audit. CRDT checkpoints and browser recovery are not worker-job checkpoints. |
| Attachments | **exists** | `page.tsx` Attachments, `src/lib/images.ts`, `api.ts` attachmentOperation, `storage-port.ts`, `supabase-storage.ts`: task/note private storage, staged validation, signed access, thumbnail/cleanup. Reuse existing task IDs/parent types; project attachment scope is not specified. |
| Custom fields/options/values | **partially exists** | `model.ts` BoardProperty/PropertyValue; `board-properties.ts`; `BoardProperties.tsx`; migration 009. Workspace-scoped text/select/multiSelect/date, stable UUID option IDs, server option validation, task inputs, card summaries, table columns/sort, board JSON export and rename propagation exist. Options are embedded definition JSON; values are embedded task JSON, so this does **not** meet the normalized schema requirement. No option colors/archive/explicit ordering, project scope, numeric/checkbox/person/relation/URL/long-text types, custom-field filtering or agent query support. |
| Agent/LLM/tools | **missing** | No provider adapter, tool registry, model orchestration, confirmation cards, proposed-ticket workflow, or agent permission capability. Package manifest has no LLM SDK. Build on extracted application services, not direct SQL or forged trusted contexts. |
| Worker/queue/job durability | **missing** | No application agent worker, lease/queue tables, job attempts, checkpoints or restart recovery. Existing local journals, request retry receipts, scheduled prune script and upstream Supabase edge functions do not implement this. |
| Frontend/design/state/forms/routing | **exists** | Next App Router/React/TypeScript; plain CSS Modules/global CSS; native forms/dialogs; React state plus useTeamspace subscriptions/localStorage and IndexedDB recovery. Native HTML drag/drop; no DnD library, Redux, external component kit or form framework. `page.tsx` owns most shell/task/board/notes UI; navigation is local state rather than entity URLs. Extend and extract components instead of replacing the design system. |
| Self-hosting/configuration | **partially exists** | `Dockerfile`, `docker.compose.supabase.yml`, `deploy/supabase.override.yml`, `.env*.example`, `scripts/prepare-supabase.mjs`, `supabase-env.mjs`, `migrate-supabase.mjs`, `publish-auth-policy.mjs`, `prune-supabase.mjs`. Pinned Supabase PostgreSQL/Auth/Storage stack plus Next web containing API routes. No separate application API container/agent worker or ticket/project demo seed. Upstream API gateway/PostgREST are not a separate ticket business API service. |
| Tests/CI/deployment evidence | **partially exists** | `tests/`, `.github/workflows/ci.yml`: unit/controller/IndexedDB/renderer, rules, trusted API, isolated PostgreSQL, Compose checks, audit gate/build. Latest local baseline: 165 unit cases + lint/typecheck/build; last backend evidence: 13 rules, 57 Firestore API, 21 PostgreSQL. Local table/calendar/mobile acceptance in BROWSER-ACCEPTANCE.md. No persisted automated browser suite; no new project/view/worker tests and no authenticated release acceptance. |

## Concrete API reuse

All routes below begin `/api`. Workspace-scoped routes reauthorize membership;
there is no public ticket directory.

| Existing contract | Purpose |
| --- | --- |
| `GET /config`; `GET/POST /workspaces` | Configuration and workspace discovery/creation. |
| `GET /workspaces/:w/snapshot` | Canonical tasks/notes/members/attachments/boardProperties snapshot. |
| `POST /workspaces/:w/tasks`; `PATCH/DELETE /workspaces/:w/tasks/:id` | Existing Ticket entity's mutations; preserve IDs and endpoint compatibility. |
| `PUT /workspaces/:w/boardProperties/:id` | Dispatcher/client contract for revision-checked field definitions; HTTP route export defect below. |
| `GET/POST /workspaces/:w/tasks/:id/comments`; `DELETE .../comments/:commentId` | Ticket conversations. Same contracts exist for notes. |
| `POST /workspaces/:w/attachments`; `POST .../:id/complete`; `GET .../:id/download` or `/thumbnail`; `DELETE .../:id` | Existing task/note upload/access lifecycle. |
| `POST/PATCH/DELETE /workspaces/:w/notes/...` with `/collaboration`, `/updates`, `/metadata`, `/history`, `/restore`, `/presence` | Existing note editing/history; preserve when adding saved-view blocks. |
| `/workspaces/:w/members`, `/invites`, `/owner`; `/administration/workspaces`; `/access/bootstrap` | Existing administration and discovery. Do not duplicate in project tools. |

## Defects and specification boundaries

1. **Fix before expanding fields:** client.ts:518 sends PUT and api.ts:1911
   handles it, but `src/app/api/[...path]/route.ts:13` exports only
   GET/POST/PATCH/DELETE. Configured field saves cannot reach that handler through
   the route. Existing field API tests call handleTrustedApi directly, bypassing
   the framework route. This is statically established; this audit's unauthenticated
   loopback HTTP probe returned 404 and did not establish a deployment-specific
   status. Add real route-boundary coverage; do not count local preview saves as
   configured-backend evidence. No fix was applied during assessment.
2. **Relative dates differ:** existing Next 7 days is today through today+6,
   excludes done, and uses viewer-local dates. Ticket wording says through
   today+7, without excluding done for This week. Encode endpoints/inclusivity,
   timezone and completion behavior explicitly; preserve old view behavior via
   migration/versioning rather than silently changing it.
3. **No task-create idempotency/CAS:** new task POST allocates an ID each request;
   task PATCH selectively merges fields but has no expected revision. Agent
   creation needs transaction-bound idempotency; approved updates need a reviewed
   revision so later changes cannot silently invalidate the approved diff.
4. **Normalization is a real migration:** PostgreSQL currently stores JSON
   documents under a global epoch/CAS protocol. Directly adding relational writes
   beside it would bypass invalidation/atomicity unless repositories and snapshots
   are adapted. Existing option UUIDs are valuable; preserve them through migration.
5. **Audit retention is unresolved:** complete prompts/outputs/before-after states
   duplicate private content. Define access/export/deletion/retention for new agent
   records before implementation. Do not store provider credentials, auth tokens,
   or hidden model reasoning. Rollback metadata means evidence for a reviewed
   compensating action, not guaranteed automatic reversal of concurrent work.
6. **Scope:** no external SaaS integrations or arbitrary custom-block runtime are
   specified. Start with a validated saved-view block referencing existing data;
   do not install a plugin system or execute user-supplied code by inference.

## Proposed implementation plan

Recommendation for review: build this feature set on the existing self-hosted
Supabase/PostgreSQL deployment, retaining Firebase's current feature set unless
full new-feature parity is explicitly requested. Reuse auth/UI/storage; introduce
no second ticket domain or separate framework merely to satisfy naming.

### M0 — Resolve architecture and semantics

- Decide PostgreSQL-only expansion versus full Firebase parity; private project
  ACLs versus existing workspace-inherited access; agent audit retention/export/
  deletion; sprint scope and relative-date behavior. These are implementation
  gates, not assumptions authorized by this audit.
- The ticket requires separate web/API/worker services. Prefer the current
  Next web/API deployment plus a separate worker initially, but this is an
  explicit deviation requiring agreement. If strict service separation is needed,
  reuse extracted services in an API entry point/container and proxy `/api` from
  web; do not implement business rules twice.

### M1 — Repair and extract the shared service boundary

- Fix the missing PUT export; extract Task/Property/Conversation authorization and
  mutation services from api.ts into modules reusable by API and worker. Auth
  constructs an actor/scope; tool payloads cannot supply privileges.
- Add task GET and bounded cursor query contract; maintain current snapshot
  shape/subscriptions until the new query UI is ready. Add task revision and
  payload-bound idempotency for creates/approved writes, preserving selective
  patches and existing comment receipts.
- Tests: actual route exports/HTTP dispatch; existing auth/outsider/concurrent
  status/detail tests; lost-response duplicate create; stale revision rejection.

### M2 — Canonical projects, tickets and normalized custom fields

- Proposed next migrations 011/012 (final split after M0): normalize existing
  Supabase Tasks into `teamspace_tasks` with the same **text IDs** and workspace
  IDs, not new UUIDs. Add `teamspace_projects`, optional project_id, priority,
  estimate and version/audit columns. Existing task IDs may be Firestore-style
  strings; preserve comments/attachments and all parent references.
- Normalize fields into `teamspace_field_definitions` (workspace/project scope,
  type/revision), `teamspace_field_options` (same existing UUID, label/color/
  position/archived_at), `teamspace_task_field_values` (one typed value per field),
  and `teamspace_task_field_selections` (unique task/field/option). Use a designated
  multi-select field for Labels. Built-in Project uses the same relationship
  mechanism surfaced to forms/queries, not an independent conflicting value.
- Support all ten requested types, including membership-validated person and
  same-workspace project relation. Single-select values must reference valid
  options belonging to the field. Reject type/coercion/cross-workspace errors.
  Archived options remain readable/removable; disallow only **new** selections,
  so unrelated edits to historical tickets continue to work.
- Migrate embedded board definitions/options/values without changing IDs or names.
  Use validation reports, backups and an atomic controlled cutover; retire old
  task/field JSON as a writable source. No indefinite dual writes or parallel
  Ticket collection. Compatibility DTOs can derive propertyValues for existing
  components. Do not promise a lossless old-client rollback after new field types.
- Adapt parent existence checks, cleanup, snapshots, live invalidation and exports
  to canonical repositories. Notes/history/CRDT stay intact. Generate/maintain
  schema types and test clean installs and upgrades from populated migration 009.
- RLS/member authorization on all user tables; service writes through authorized
  transactions, including worker calls. Add scoped FK/uniqueness/type checks and
  indexes for workspace/project/assignee/status/priority/due-date; typed field
  lookup/range indexes and selection joins by field/option/task. Query-plan tests
  prevent silently falling back to full-workspace JSON scans.
- Contracts: retain `/tasks` mutations; add `GET/POST /projects`, `GET/PATCH
  /projects/:id`, `/fields`, `/fields/:id/options` and option PATCH/archive.
  Project detail returns a ticket-query reference, not copied ticket records.
- UI: extract TaskDialog/WorkspaceBoard; add ProjectList, ProjectPage, ProjectLink,
  typed FieldInput and OptionManager. Expose audit metadata. Project archive or
  delete policy requires an explicit contract; no implicit cascading ticket loss.
- Tests: CRUD/relations/revocation; upgrade preservation/foreign IDs; every type;
  option rename/color/order/archive races and historical values; concurrent edits;
  attachment/comment preservation; export/deletion behavior and RLS on each table.

### M3 — One query language and persistent views

- Proposed migration 013: `teamspace_saved_views` with layout, source, bounded
  versioned filter tree, grouping, sort array, visible field IDs and owner/scope.
  Preserve existing note BoardView settings through an adapter; never overwrite
  those settings with a new default or duplicate underlying tickets.
- `POST /workspaces/:w/tasks/query` accepts a validated AND/OR tree, sorts and
  cursor/limit; returns rows, nextCursor and schema/view version. Shared compiler
  validates field/operator/type combinations and parameterizes SQL. No SQL from
  users or models. Define null, case, date, numeric ordering and archived-option
  semantics once for UI, exports and agent tools. Bound depth/clauses/cost.
- `GET/POST /views`, `GET/PATCH /views/:id` use revision checks. Persist URLs with
  project/view/ticket IDs and validated override state; viewer-relative `me` and
  date tokens resolve on the server with an explicit timezone/date contract.
- UI: FilterBuilder, ViewToolbar/ViewPicker, TaskList, reusable board/table
  adapters, grouping controls, ticket/project routes. Optimistic status/field
  overlay must reconcile ACKs/failures and never overwrite unrelated live edits.
- Seed idempotently: Engineering Kanban; selected-project board; My open work;
  This week; Overdue. Include sprint/range views only after sprint semantics
  are agreed. New saved-view note block stores a view ID, not ticket copies.
- Tests: every required field operator, nested AND/OR, paging/ties/nulls, scope
  isolation, saved/URL state, default view semantics/timezones/DST, option rename/
  archive propagation, and browser drag/table/filter/export across two clients.

### M4 — Read-only agent and durable runs

- Proposed migration 014: jobs/runs, bounded checkpoints and append-only run
  events/tool calls. PostgreSQL queue with atomic claims, leases, heartbeat,
  attempts/backoff/dead-letter state; separate worker and private DB credentials.
  Recheck actor membership at execution/resumption; do not persist bearer tokens.
- Shared provider interface for model messages and validated tool requests;
  provider adapters can support hosted OpenAI-compatible and configured local
  endpoints. Capability/context limits vary; unsupported tools fail explicitly.
  Select exact dependencies only after license/maintenance review.
- Implement `search_projects`, `search_tickets`, `get_project`, `get_ticket`,
  `summarize_project`, `summarize_tickets`, `propose_ticket_plan`. Search tools
  return authorized IDs; worker records their provenance and validates all later
  references. All searches use the M3 query contract. Summaries retain provenance;
  model-inferred blockers are distinguished from stored data.
- API: `POST /agent/runs`, `GET /agent/runs/:id` plus bounded events/status polling
  (or streaming). UI: AgentPanel, RunStatus, editable TicketPlan with per-item
  approve/reject. Proposed plans have no mutation capability yet.
- Tests: unauthorized/foreign IDs, injection in notes/comments, model tool-schema
  failures, timeout/retry/lease takeover, duplicate deliveries, worker restart and
  audit completeness with sensitive credentials excluded.

### M5 — Confirmed writes and production acceptance

- Proposed migration 015: approval records bind actor, workspace, tool name,
  canonical payload digest, reviewed revision, exact resolved IDs and expiry.
  Pending runs pause without holding a database transaction. Edits invalidate the
  old approval. Explicit confirmation resumes only the approved action.
- `create_ticket` maps to the same Task create service, `update_ticket` to its
  revision-checked patch, `add_comment` to existing comment logic. Tool vocabulary
  does not introduce a second REST/entity model. Add `/agent/runs/:id/approvals`
  for approve/reject; require normal authenticated actor authorization.
- Consume approval, persist mutation/result/receipt and audit before/after state
  atomically. Recovery replays an idempotency key, never repeats an uncertain
  create. Batch plans commit only approved items and report per-item results.
  Never blindly roll back a later user's changes. No delete tool in v1.
- UI: exact field/value diff cards, item editing, re-review on stale revisions,
  audit viewer and resulting project-board link. Record failures separately from
  successful effects; before/after/rollback metadata follows the agreed policy.
- Compose: add worker and the agreed API topology; reuse existing PostgreSQL,
  Auth/Storage and migration ledger. No Redis unless measured need warrants it.
  Add idempotent demo seed, health/readiness and automatic job recovery checks.
- CI: clean+populated upgrades, generated-type checks, RLS, all existing suites,
  queue restart/duplicate-approval tests and browser two-user acceptance. Test full
  Compose startup, signed attachments and seed repeatability; API/worker restart
  mid-commit must produce one result/audit outcome. Preserve existing auth/editor
  recovery behavior. Runtime audit/license release gates still apply.

## Decisions required before implementation

1. New feature scope: PostgreSQL-only expansion with existing Firebase features
   retained, or full feature parity on both backends?
2. Projects inherit workspace membership, or introduce private project access?
3. Approve current Next web/API plus separate worker, or require separate API
   container from the start as the ticket specifies?
4. Agent audit retention/export/deletion and project archive/deletion rules;
   sprint entity versus scoped field; relative date bounds/timezone.

The user requested ticket assessment. No application code, dependencies, schema,
live configuration, auth policy or data retention was changed by this audit.
