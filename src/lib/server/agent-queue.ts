import "server-only";
import { ApiError, identifier, integer, object, text, uuid } from "./validation";
import type { ServiceActor } from "./service-context";

export type AgentRunStatus = "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";
export type AgentRunContext = { projectId?: string; noteId?: string };
export type AgentCheckpoint = { version: 1; [key: string]: unknown };
export type AgentRun = {
  id: string; workspace_id: string; initiator_id: string; status: AgentRunStatus;
  prompt: string; context: AgentRunContext; result: Record<string, unknown> | null;
  error_code: string | null; attempts: number; version: number; last_sequence: number;
  created_at: string; updated_at: string; expires_at: string;
};
export type LeasedAgentRun = AgentRun & {
  status: "running"; checkpoint: AgentCheckpoint; available_at: string;
  lease_token: string; lease_until: string; worker_id: string; event_bytes: number;
};
export type AgentEventKind = "queued" | "claimed" | "lease_expired" | "model_request" | "model_result" | "tool_request" | "tool_result" | "retrying" | "completed" | "failed" | "cancelled";
export type AgentEvent = { run_id: string; sequence: number; kind: AgentEventKind; payload: Record<string, unknown>; created_at: string };
export type AgentRunRead = { run: AgentRun; events: AgentEvent[] };
export type AgentRunExport = AgentRunRead & { formatVersion: 1; exportedAt: string; checkpoint: AgentCheckpoint };
export type AgentRequestReceipt = { initiator_id: string; operation_id: string; digest: string; run_id: string; created_at: string };
export type AgentLease = { id: string; lease_token: string; worker_id: string; version: number };
type Rpc = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export function agentRetentionDays(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = env.AGENT_AUDIT_RETENTION_DAYS ?? "30";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 365)
    throw new ApiError(503, "agent_configuration", "AGENT_AUDIT_RETENTION_DAYS must be an integer from 1 to 365.");
  return Number(value);
}
const statuses: AgentRunStatus[] = ["queued", "running", "retrying", "completed", "failed", "cancelled"];
const eventKinds: AgentEventKind[] = ["queued", "claimed", "lease_expired", "model_request", "model_result", "tool_request", "tool_result", "retrying", "completed", "failed", "cancelled"];
function bad(): never { throw new ApiError(503, "agent_queue_unavailable", "The agent queue is unavailable. Retry shortly."); }
function data(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  return value as Record<string, unknown>;
}
function run(value: unknown): AgentRun {
  const row = data(value);
  if (typeof row.id !== "string" || typeof row.workspace_id !== "string" || typeof row.initiator_id !== "string" || !statuses.includes(row.status as AgentRunStatus)
    || typeof row.prompt !== "string" || !row.context || typeof row.context !== "object" || Array.isArray(row.context)
    || !Number.isSafeInteger(row.version) || (row.version as number) < 1 || !Number.isSafeInteger(row.attempts) || (row.attempts as number) < 0 || (row.attempts as number) > 3
    || !Number.isSafeInteger(row.last_sequence) || (row.last_sequence as number) < 0 || (row.last_sequence as number) > 200
    || !(row.result === null || (row.result && typeof row.result === "object" && !Array.isArray(row.result))) || !(row.error_code === null || typeof row.error_code === "string")
    || ![row.created_at, row.updated_at, row.expires_at].every(value => typeof value === "string" && Number.isFinite(Date.parse(value)))) return bad();
  // Never forward an unexpectedly widened RPC response's lease/checkpoint fields
  // through an ordinary read/list/create result.
  return Object.fromEntries(["id", "workspace_id", "initiator_id", "status", "prompt", "context", "result", "error_code", "attempts", "version", "last_sequence", "created_at", "updated_at", "expires_at"].map(key => [key, row[key]])) as AgentRun;
}
function event(value: unknown): AgentEvent {
  const row = data(value);
  if (typeof row.run_id !== "string" || !Number.isInteger(row.sequence) || (row.sequence as number) < 1 || (row.sequence as number) > 200
    || !eventKinds.includes(row.kind as AgentEventKind) || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return bad();
  return { run_id: row.run_id, sequence: row.sequence as number, kind: row.kind as AgentEventKind, payload: row.payload as Record<string, unknown>, created_at: row.created_at };
}
function receipt(value: unknown): AgentRequestReceipt {
  const row = data(value);
  if (![row.initiator_id, row.operation_id, row.run_id].every(value => typeof value === "string") || typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return bad();
  return Object.fromEntries(["initiator_id", "operation_id", "digest", "run_id", "created_at"].map(key => [key, row[key]])) as AgentRequestReceipt;
}
function checkpoint(value: unknown): AgentCheckpoint {
  const row = object(value, Object.keys(data(value)));
  if (row.version !== 1 || Buffer.byteLength(JSON.stringify(row), "utf8") > 512000)
    throw new ApiError(400, "invalid_input", "Invalid agent checkpoint.");
  return row as AgentCheckpoint;
}
function leaseInput(lease: AgentLease) {
  return { id: uuid(lease.id), token: uuid(lease.lease_token), worker: identifier(lease.worker_id) };
}

/** Internal Supabase service client; no browser route constructs it yet. Authority
 * is supplied by the server, not model input. SQL reauthorizes every operation.
 * Generic checkpoint JSON is private worker state; the future engine must also
 * validate its own versioned message/provenance/phase contract on resume. */
export function createAgentQueue(rpc: Rpc, required: boolean, retentionDays = 30) {
  integer(retentionDays, "Audit retention days", 1, 365);
  if (typeof required !== "boolean") throw new ApiError(503, "agent_configuration", "Invalid agent authentication policy.");
  async function call(action: string, input: Record<string, unknown>) {
    let value: unknown;
    try { value = await rpc("teamspace_agent_queue", { p_action: action, p_input: { ...input, required } }); }
    catch { return bad(); }
    const response = data(value);
    if (response.error) {
      const errors: Record<string, number> = { forbidden: 403, email_confirmation_required: 403, policy_mismatch: 503,
        invalid_input: 400, invalid_context: 400, operation_conflict: 409, expired: 410, not_found: 404,
        queue_full: 429, rate_limited: 429, lease_lost: 409, version_conflict: 409, audit_limit: 409 };
      const code = String(response.error);
      if (!Object.hasOwn(errors, code)) return bad();
      throw new ApiError(errors[code], code, `Agent queue: ${code}.`);
    }
    return response;
  }
  const authority = (workspace: string, actor: ServiceActor) => ({ workspace: identifier(workspace), uid: identifier(actor.uid), verified: actor.email_verified === true });
  const target = (workspace: string, actor: ServiceActor, id: string) => ({ ...authority(workspace, actor), id: uuid(id) });
  async function read(workspace: string, actor: ServiceActor, id: string, exportContent: boolean) {
    const result = await call(exportContent ? "export" : "read", target(workspace, actor, id));
    if (!Array.isArray(result.events) || result.events.length > 200) return bad();
    const base: AgentRunRead = { run: run(result.run), events: result.events.map(event) };
    return exportContent ? { ...base, formatVersion: 1 as const, exportedAt: String(result.exportedAt), checkpoint: checkpoint(result.checkpoint) } : base;
  }
  return {
    async create(workspace: string, actor: ServiceActor, input: unknown) {
      const value = object(input, ["operationId", "prompt", "context"]);
      const context = value.context === undefined ? {} : object(value.context, ["projectId", "noteId"]);
      const normalized: AgentRunContext = {};
      for (const key of ["projectId", "noteId"] as const) if (key in context) normalized[key] = identifier(context[key]);
      const result = await call("create", { ...authority(workspace, actor), operationId: uuid(value.operationId),
        prompt: text(value.prompt, "Agent prompt", 16000), context: normalized, retentionDays });
      return { run: run(result.run), replayed: result.replayed === true };
    },
    async list(workspace: string, actor: ServiceActor) {
      const result = await call("list", authority(workspace, actor));
      if (!Array.isArray(result.runs) || result.runs.length > 50) return bad();
      return result.runs.map(run);
    },
    read: (workspace: string, actor: ServiceActor, id: string) => read(workspace, actor, id, false) as Promise<AgentRunRead>,
    export: (workspace: string, actor: ServiceActor, id: string) => read(workspace, actor, id, true) as Promise<AgentRunExport>,
    async exportRequests(workspace: string, actor: ServiceActor, cursor?: { initiatorId: string; operationId: string }) {
      const result = await call("export_requests", { ...authority(workspace, actor), ...(cursor ? { afterInitiator: identifier(cursor.initiatorId), afterOperation: uuid(cursor.operationId) } : {}) });
      if (!Array.isArray(result.requests) || result.requests.length > 501) return bad();
      const page = result.requests.slice(0, 500).map(receipt);
      const last = page.at(-1);
      return { requests: page, nextCursor: result.requests.length > 500 && last ? { initiatorId: last.initiator_id, operationId: last.operation_id } : null };
    },
    async cancel(workspace: string, actor: ServiceActor, id: string) { return run((await call("cancel", target(workspace, actor, id))).run); },
    async claim(worker: string): Promise<LeasedAgentRun | null> {
      const value = (await call("claim", { worker: text(worker, "Worker ID", 100) })).run;
      if (value === null) return null;
      const row = data(value), safe = run(row);
      if (safe.status !== "running" || typeof row.lease_until !== "string" || typeof row.available_at !== "string" || !Number.isSafeInteger(row.event_bytes)) return bad();
      return { ...safe, status: "running", checkpoint: checkpoint(row.checkpoint), lease_token: uuid(row.lease_token),
        worker_id: identifier(row.worker_id), lease_until: row.lease_until, available_at: row.available_at, event_bytes: row.event_bytes as number };
    },
    async heartbeat(lease: AgentLease) { return String((await call("heartbeat", leaseInput(lease))).leaseUntil); },
    async save(lease: AgentLease, input: { checkpoint: AgentCheckpoint; status: "running" | "retrying" | "completed" | "failed";
      kind: "model_request" | "model_result" | "tool_request" | "tool_result" | "retrying" | "completed" | "failed";
      payload: Record<string, unknown>; result?: Record<string, unknown>; errorCode?: string }) {
      const value = object(input, ["checkpoint", "status", "kind", "payload", "result", "errorCode"]);
      checkpoint(value.checkpoint);
      return run((await call("checkpoint", { ...value, ...leaseInput(lease), version: integer(lease.version, "Run version", 1, 1000000) })).run);
    },
    async prune() {
      const result = await call("prune", {});
      if (!Number.isSafeInteger(result.deleted) || typeof result.moreAvailable !== "boolean") return bad();
      return { deleted: result.deleted as number, moreAvailable: result.moreAvailable };
    },
  };
}
