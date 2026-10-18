import "server-only";
import type { DocumentStore, DocumentReference } from "./document-store";
import { member, rateLimit, now, hash, type ServiceActor } from "./service-context";
import { ApiError, object, text, integer, uuid, taskInput } from "./validation";
import type { TaskTemplate } from "../model";

export function templateView(id: string, row: Record<string, unknown>): TaskTemplate {
  return { id, name: row.name as string, defaults: row.defaults as TaskTemplate["defaults"], revision: row.revision as number, archived: row.archived === true };
}

export async function saveTaskTemplate(db: DocumentStore, workspace: DocumentReference, user: ServiceActor, id: string, input: unknown) {
  await rateLimit(db, user.uid, "task_template", 30);
  const data = object(input, ["name", "defaults", "expectedRevision", "archived"]);
  const expected = integer(data.expectedRevision, "Expected revision", 0, 1000000000);
  const name = text(data.name, "Template name", 80);
  const fields = object(data.defaults, ["title", "description", "content", "status", "assigneeId", "dueDate", "propertyValues", "projectId", "priority", "estimate"]);
  if (!("content" in fields)) throw new ApiError(400, "invalid_input", "A template needs a block body.");
  const { position: ignored, ...defaults } = taskInput(fields, false);
  void ignored;
  if (data.archived !== undefined && typeof data.archived !== "boolean") throw new ApiError(400, "invalid_input", "Archived must be a boolean.");
  const archived = data.archived === true;
  const digest = hash(JSON.stringify({ name, defaults, archived }));
  const ref = workspace.collection("taskTemplates").doc(uuid(id));
  return db.runTransaction(async tx => {
    await member(tx, workspace, user.uid);
    const [space, prior, rows] = await Promise.all([tx.get(workspace), tx.get(ref), tx.get(workspace.collection("taskTemplates"))]);
    const previous = prior.data();
    if (previous?.revision === expected + 1 && previous.lastDigest === digest && previous.updatedBy === user.uid)
      return templateView(ref.id, previous);
    if ((previous?.revision ?? 0) !== expected) throw new ApiError(409, "revision_conflict", "This template changed. Reopen it before saving.");
    if (!prior.exists && rows.size >= 64) throw new ApiError(409, "template_limit", "This workspace supports 64 templates, including archived templates. Reuse an existing template.");
    const row = { name, defaults, archived, revision: expected + 1, lastDigest: digest, updatedBy: user.uid, updatedAt: now() };
    tx.set(ref, row);
    tx.update(workspace, { taskTemplatesRevision: (space.data()?.taskTemplatesRevision ?? 0) + 1 });
    return templateView(ref.id, row);
  });
}
