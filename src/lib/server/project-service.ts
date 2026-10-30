import "server-only";
import { randomUUID } from "node:crypto";
import type { DocumentStore, DocumentReference, StoreData } from "./document-store";
import { member, rateLimit, now, hash, type ServiceActor } from "./service-context";
import { ApiError, identifier, integer, object, text } from "./validation";
import type { Project } from "../model";
import { validateEntityRelationValues } from "./entity-database-service";

export function requireProjects(db: DocumentStore) {
  if (!db.capabilities?.projects)
    throw new ApiError(400, "feature_unavailable", "Projects require the PostgreSQL deployment.");
}
function view(id: string, data: StoreData): Project {
  return { id, name: data.name, description: data.description ?? "", archived: data.archived === true, revision: data.revision, ...(data.databaseRelations !== undefined ? {databaseRelations:data.databaseRelations} : {}) };
}
export async function getProject(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id: string) {
  requireProjects(db);
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const row = await tx.get(workspace.collection("projects").doc(identifier(id)));
    if (!row.exists) throw new ApiError(404, "not_found", "Project not found.");
    return view(row.id, row.data()!);
  });
}
export async function saveProject(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id: string | undefined, input: unknown) {
  requireProjects(db);
  await rateLimit(db, actor.uid, "project_write", 30);
  const data = object(input, id ? ["name", "description", "archived", "databaseRelations", "expectedRevision"] : ["name", "description", "databaseRelations", "operationId"]);
  const projectName = "name" in data ? text(data.name, "Project name", 200) : undefined;
  const description = "description" in data ? text(data.description, "Project description", 10000, true) : undefined;
  if (!id && projectName === undefined) throw new ApiError(400, "invalid_input", "A project needs a name.");
  if ("archived" in data && typeof data.archived !== "boolean") throw new ApiError(400, "invalid_input", "Invalid project archive state.");
  if (id && !["name", "description", "archived", "databaseRelations"].some(key => key in data)) throw new ApiError(400, "invalid_input", "No project changes supplied.");
  const expected = id ? integer(data.expectedRevision, "Expected revision", 1, Number.MAX_SAFE_INTEGER - 1) : 0;
  const operationId = "operationId" in data ? text(data.operationId, "Operation ID", 36) : undefined;
  if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new ApiError(400, "invalid_input", "Expected a UUID v4.");
  const ref = workspace.collection("projects").doc(id ? identifier(id) : operationId ? `p_${hash(`${actor.uid}:${operationId.toLowerCase()}`)}` : randomUUID());
  const digest = hash(JSON.stringify([actor.uid, projectName, description ?? "", ...("databaseRelations" in data ? [data.databaseRelations] : [])]));
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const row = await tx.get(ref);
    if (!id && row.exists) {
      if (row.data()?.creationDigest !== digest) throw new ApiError(409, "operation_conflict", "This project operation was already used with different content.");
      return view(row.id, row.data()!);
    }
    if (id && !row.exists) throw new ApiError(404, "not_found", "Project not found.");
    if (id && row.data()?.revision !== expected) throw new ApiError(409, "revision_conflict", "The project changed. Reopen it to review the current version.");
    const relations = "databaseRelations" in data ? await validateEntityRelationValues(tx,workspace,"project",data.databaseRelations,row.data()?.databaseRelations ?? {}) : undefined;
    const next = {
      ...row.data(), ...(projectName !== undefined ? { name: projectName } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(id ? {} : { description: description ?? "", archived: false, createdAt: now(), createdBy: actor.uid, creationDigest: digest }),
      ...("archived" in data ? { archived: data.archived } : {}),
      ...(relations !== undefined ? { databaseRelations: relations } : {}),
      revision: expected + 1, updatedAt: now(), updatedBy: actor.uid,
    };
    if (id) tx.update(ref, next); else tx.create(ref, next);
    return view(ref.id, next);
  });
}
