# M4a provider and read-tool contracts

These are internal server components, not a deployed agent. M4b adds the
[private durable queue/audit boundary](../migrations/014-agent-queue.md), prepared
for deployment but not applied to a live database here. There is no run API,
worker or agent UI yet. Importing these components does not contact a model.
The application does not construct the provider automatically. Do not wire an
HTTP route directly to `complete`: connect it through the fenced checkpoint engine
and queue, including authorized retention/export/deletion and revocation handling.

## Provider transport

`src/lib/server/agent-provider.ts` uses native `fetch` and the Chat Completions
function-calling protocol for administrator-configured hosted or local compatible
endpoints. This protocol was chosen for that compatibility requirement; it adds
no SDK dependency. Official references:
[function calling](https://developers.openai.com/api/docs/guides/function-calling)
and [Chat Completions create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Compatibility requires function calls, `max_completion_tokens`, `store: false`
and the other selected request fields. Unsupported endpoints fail explicitly;
the adapter does not silently remove limits, change model or switch provider.

Future worker runtime settings (not browser/build arguments):

| Setting | Contract |
| --- | --- |
| `AGENT_ENABLED` | Strict true/false; false by default. Disabled construction requires no model credentials and sends no request. |
| `BACKEND_PROVIDER` | Must be `supabase` when enabled. Existing web backend configuration validation still applies at its boundary. |
| `AGENT_MODEL` | Required explicit model ID; no automatic model choice. |
| `AGENT_BASE_URL` | Required HTTP(S) API root, e.g. administrator's endpoint ending in `/v1`; the adapter appends `/chat/completions`. No URL credentials/query/fragment. |
| `AGENT_ALLOW_HTTP` | Strict true/false; false by default. Explicit administrator opt-in for a trusted local/network endpoint using plain HTTP. |
| `AGENT_API_KEY` | Runtime secret only, optional for a keyless compatible endpoint. No key appears in the returned provider description. |
| `AGENT_MAX_COMPLETION_TOKENS` | Integer 128–8192; defaults to 2048. Includes any provider reasoning-token budget, not just visible text. |

One adapter call makes one request, with a 30-second deadline spanning fetch/body
read, at most 512,000 request bytes and 256,000 decoded response bytes. It refuses
redirects, preventing credential/prompt forwarding to a redirect target. The
caller can cancel; native fetch is used in production. Injected transports are a
test seam and must honor the signal. There is no implicit retry or provider spend
during construction, tests or application startup.

The adapter reconstructs wire messages from selected fields; checks message/call
correlation, complete tool results and duplicate IDs; advertises only a subset of
the seven allowed read/proposal names; accepts at most four calls per reply and
32,000 UTF-8 argument bytes per call. It refuses unknown/unadvertised/write names,
nonobject JSON arguments, malformed UTF-8/JSON, multiple choices, incompatible
finish reasons and truncated completions. Visible assistant text is bounded to
16,000 characters. Returned fields are visible content, parsed calls and optional
nonnegative numeric input/output usage. Provider-specific reasoning, signatures,
raw bodies and metadata are excluded. Provider error bodies are cancelled without
reading; errors contain stable codes and a retryability classification, with no
URL/key/raw exception cause. A deadline/network/429/5xx failure is retryable;
auth, input, malformed response, size and truncation errors are not. Cancellation
is distinct and not retryable.

Schemas are deliberately non-strict for compatible endpoint support, with closed
top-level objects. Actual tool services always validate the full input. A
provider-validated JSON object is never authority to execute an arbitrary tool.

## Read tools

`src/lib/server/agent-tools.ts` binds a policy-guarded store, workspace reference
and authenticated actor on the server. None can be replaced through model JSON.
Every content operation rechecks membership and published email policy in the
existing services/transaction. This is not account reauthentication: the future
worker must check deleted/banned/anonymous accounts on execution and resumption.
Firebase rejects this feature; existing Firebase routes remain unchanged.

| Tool | Selected output / behavior |
| --- | --- |
| `search_projects` | Up to 20 Projects and 20 members; optional exact name filters, explicit truncation flags. Returns all 32-or-fewer field summaries, initiating user ID, and optionally one previously returned field's full options. No email addresses. Exact-name refinement is available when a catalog is truncated; substring/fuzzy Project search is not implemented. |
| `search_tickets` | Reuses `queryTickets`' indexed, bounded version 1 AST/compiler, schema and viewer-bound live keysets. Up to 20 ticket summaries; no SQL argument. A cursor exceeding 16,000 characters is withheld with `cursorUnavailable: true` and `resultsTruncated: true`, so a pathological text sort cannot overflow the tool response. Narrow/change the query in that case. |
| `get_project` | Current authorized detail for a returned ID; archive does not hide history. |
| `get_ticket` | Current detail, custom values (long strings excerpted to 256 characters with field IDs marked), latest ten comment excerpts (1,000 characters each). Description up to 10,000 characters; summary excerpts up to 500. |
| `summarize_project` | Current Project plus first 20 matching tickets, live cursor/truncation and **observed** status counts. Requires explicit IANA timezone. Does not claim full Project totals or infer blockers. |
| `summarize_tickets` | Up to 20 distinct returned IDs; live selected summaries and observed counts. |
| `propose_ticket_plan` | Up to 20 new-ticket inputs validated with existing task/custom-value validators; checks current member/active Project/field scope/option state. Returns a versioned proposal with `saved: false`, `requiresHumanReview: true`. Performs no ticket/comment/field/Project write. |

Model references must have been returned as selected authoritative IDs in this
tool session. IDs embedded in source descriptions, comments or proposed text do
not become capabilities. Catalog refinement supplies exact member/field/option
identities before proposing assignments or filtering typed references. Up to 512
IDs per kind may be observed; provenance updates are atomic when an output is
accepted. A session is bound to one workspace/actor; another session does not
inherit its references. There is no persisted provenance restore API yet.

Tool inputs are bounded to 32,000 UTF-8 bytes and outputs to 64,000; over-budget
output fails explicitly rather than silently presenting partial facts. Reads can
observe changes between individual service calls; this is not a frozen workspace
snapshot. Search reuses the existing distributed query rate limit (and therefore
writes rate-limit metadata), but no tool mutates workspace content. All other run
quotas and step limits belong at the future queue/worker boundary.

## Remaining M4 work after M4b

- Wire migration 014's tested queue/audit client into a bounded worker and run
  API. SQL now enforces initiator/admin RLS, account revocation, leases, quotas,
  cancellation, retry identity, expiry, exports and workspace deletion; operator
  cleanup includes audit pruning. No live queue or worker is running yet.
- Atomic checkpoints/provenance/events before and after provider/tool calls,
  bounded step/total-context budgets, explicit crash uncertainty, retry/backoff
  and process restart tests. Provider billing cannot be exactly once after a
  crash; read-only tools can safely repeat. No underlying writes before M5.
- Separate worker build/runtime (the source `server-only` marker is handled by
  Next today; do not assume a standalone Node worker can resolve it), optional
  Compose worker, runtime secrets, health checks, graceful shutdown and run UI.
- Fake-provider end-to-end runs and lease/revocation/retention/export/deletion
  races on real PostgreSQL; live compatible provider acceptance remains external.

M4a added no schema. M4b adds migration 014's three private tables and runtime
retention configuration, documented separately; no background process or model
request starts automatically. Full worker/UI acceptance remains ahead.
