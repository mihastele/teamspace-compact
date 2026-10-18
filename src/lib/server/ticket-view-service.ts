import "server-only";
import { randomUUID } from "node:crypto";
import type { BoardProperty } from "../model";
import { defaultTicketViews, resolveTicketQuery, validateTicketQuery, validateViewConfig } from "../ticket-query";
import { compileTicketQuery } from "./ticket-query-sql";
import { ApiError, identifier, integer, object, uuid } from "./validation";
import { hash, member, now, rateLimit, type ServiceActor } from "./service-context";
import type { DocumentStore, DocumentReference } from "./document-store";
import { requireProjects } from "./project-service";

function view(id: string, data: Record<string, unknown>) {
  return {id,...Object.fromEntries(["name","layout","groupBy","columns","query","revision","archived"].map(key=>[key,data[key]]))};
}
function bad(error: unknown): never { throw error instanceof ApiError ? error : new ApiError(400, "invalid_query", error instanceof Error ? error.message : "Invalid ticket query."); }
function readError(result: Record<string, unknown>) {
  if (!result.error) return;
  if (result.error === "forbidden") throw new ApiError(403, "forbidden", "You do not have access to this workspace.");
  if (result.error === "policy_mismatch") throw new ApiError(503, "policy_mismatch", "Authentication policy must be published before this deployment accepts traffic.");
  throw new ApiError(403, "email_confirmation_required", "Confirm your email before opening the workspace.");
}
export async function queryTickets(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, input: unknown) {
  requireProjects(db);
  if (!db.ticketRead) throw new ApiError(503, "query_unavailable", "Indexed ticket queries are not available.");
  const data = object(input, ["query", "limit", "cursor", "projectId"]);
  const limit = data.limit === undefined ? 50 : integer(data.limit, "Query limit", 1, 100);
  const projectId = data.projectId === undefined || data.projectId === null ? undefined : identifier(data.projectId);
  if (data.cursor !== undefined && (typeof data.cursor !== "string" || data.cursor.length > 300000)) throw new ApiError(400, "invalid_cursor", "Invalid query cursor.");
  await rateLimit(db, actor.uid, "ticket_query", 120);
  for (let attempt = 0; attempt < 8; attempt++) {
    const base = { p_workspace: workspace.id, p_uid: actor.uid };
    const context = await db.ticketRead("context", base);
    readError(context);
    const fields = context.fields as BoardProperty[];
    try {
      const query = validateTicketQuery(data.query, fields);
      const resolved = resolveTicketQuery(query, actor.uid, projectId, new Date(), fields);
      const fingerprint = hash(JSON.stringify([workspace.id, actor.uid, resolved, fields.map(field => [field.id, field.revision]).sort()]));
      let after: unknown[] | undefined;
      if (data.cursor) {
        let cursor: Record<string, unknown>;
        try { cursor = JSON.parse(Buffer.from(data.cursor as string, "base64url").toString("utf8")); } catch { throw new ApiError(400, "invalid_cursor", "Invalid query cursor."); }
        if (cursor?.fingerprint !== fingerprint) throw new ApiError(409, "cursor_changed", "This query or its field definitions changed. Refresh the first page.");
        if (!Array.isArray(cursor.after)) throw new ApiError(400, "invalid_cursor", "Invalid cursor keys.");
        after = cursor.after;
      }
      const compiled = compileTicketQuery(resolved, fields, after);
      const result = await db.ticketRead("query", { ...base, p_epoch: context.epoch, p_where: compiled.where, p_order: compiled.order, p_keys: compiled.keys, p_parameters: compiled.parameters, p_limit: limit + 1 });
      readError(result);
      if (result.conflict) continue;
      const rows = result.rows as { id: string; data: Record<string, unknown>; keys: unknown[] }[];
      const page = rows.slice(0, limit);
      return { tasks: page.map(row => ({ ...row.data, id: row.id })), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ fingerprint, after: page.at(-1)!.keys })).toString("base64url") : null, queryVersion: 1, schema: fields.map(field => ({ id: field.id, revision: field.revision })), timeZone: query.timeZone };
    } catch (error) { bad(error); }
  }
  throw new ApiError(503, "query_contention", "The workspace is busy. Retry the query.");
}

export async function readViews(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id?: string) {
  requireProjects(db);
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    if (id) {
      const row = await tx.get(workspace.collection("savedViews").doc(identifier(id)));
      if (!row.exists) throw new ApiError(404, "not_found", "Saved view not found.");
      return { view: view(row.id,row.data()!) };
    }
    const rows = await tx.get(workspace.collection("savedViews").limit(65));
    return { views: rows.docs.map(row => view(row.id,row.data())) };
  });
}
export async function saveView(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id: string | undefined, input: unknown) {
  requireProjects(db);
  await rateLimit(db, actor.uid, "view_write", 40);
  const data = object(input, ["config", "expectedRevision", "operationId", "archived"]);
  const expected = id ? integer(data.expectedRevision, "Expected view revision", 1, 1000000000) : 0;
  const operationId = data.operationId === undefined ? undefined : uuid(data.operationId);
  if (id && operationId) throw new ApiError(400, "invalid_input", "Operation IDs are for view creation.");
  if (data.archived !== undefined && typeof data.archived !== "boolean") throw new ApiError(400, "invalid_input", "Invalid view archive state.");
  if (!id && (data.archived !== undefined || data.expectedRevision !== undefined)) throw new ApiError(400, "invalid_input", "Create cannot archive or review an existing view.");
  const ref = workspace.collection("savedViews").doc(id ? identifier(id) : operationId ? `v_${hash(`${actor.uid}:${operationId}`)}` : randomUUID());
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const [rows, definitions, prior] = await Promise.all([tx.get(workspace.collection("savedViews")), tx.get(workspace.collection("boardProperties")), tx.get(ref)]);
    const fields = definitions.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty);
    let config;
    try { config = validateViewConfig(data.config ?? (prior.data() && Object.fromEntries(["name", "layout", "groupBy", "columns", "query"].map(key => [key, prior.data()![key]]))), fields); } catch (error) { bad(error); }
    const digest = hash(JSON.stringify(config));
    if (!id && prior.exists) {
      if (prior.data()?.creationDigest !== digest) throw new ApiError(409, "operation_conflict", "This view creation operation was already used with different settings.");
      return view(ref.id,prior.data()!);
    }
    if (id && !prior.exists) throw new ApiError(404, "not_found", "Saved view not found.");
    if (id && prior.data()?.revision !== expected) throw new ApiError(409, "revision_conflict", "This view changed. Reopen it to review its latest settings.");
    if (!prior.exists && rows.size >= 64) throw new ApiError(409, "view_limit", "This workspace supports 64 saved views including archived views.");
    const next = { ...prior.data(), ...config, revision: expected + 1, archived: data.archived ?? prior.data()?.archived ?? false, ...(!id ? { createdAt: now(), createdBy: actor.uid, creationDigest: digest } : {}), updatedAt: now(), updatedBy: actor.uid };
    if (id) tx.update(ref, next); else tx.create(ref, next);
    return view(ref.id,next);
  });
}
export async function seedViews(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor) {
  requireProjects(db);
  await rateLimit(db, actor.uid, "view_seed", 10);
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const rows = await tx.get(workspace.collection("savedViews"));
    const defaults = defaultTicketViews().filter(view => !rows.docs.some(row => row.id === view.id));
    if (rows.size + defaults.length > 64) throw new ApiError(409, "view_limit", "There is no room for the default views.");
    for (const { id, ...config } of defaults) tx.create(workspace.collection("savedViews").doc(id), { ...config, archived: false, revision: 1, createdAt: now(), updatedAt: now(), createdBy: actor.uid });
    return { created: defaults.length };
  });
}
