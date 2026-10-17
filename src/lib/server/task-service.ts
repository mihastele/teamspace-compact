import "server-only";
import { Timestamp, type DocumentStore as Firestore, type DocumentReference } from "./document-store";
import { member, rateLimit, now, hash, type ServiceActor } from "./service-context";
import { ApiError, identifier, integer, object, taskMutationInput, uuid } from "./validation";
import { propertyDefinition, validatePropertyChange, validatePropertyValues } from "../board-properties";
import type { BoardProperty } from "../model";
import { requireProjects } from "./project-service";

export function taskRevision(value: Record<string, unknown>): number {
  const revision = value.revision ?? 0;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    throw new ApiError(503, "invalid_task_state", "This task needs administrator review before it can be changed.");
  return revision;
}

export function nextTaskRevision(value: Record<string, unknown>): number {
  const revision = taskRevision(value);
  if (revision >= Number.MAX_SAFE_INTEGER)
    throw new ApiError(409, "revision_limit", "This task has reached its revision limit.");
  return revision + 1;
}

function taskView(id: string, value: Record<string, unknown>) {
  return {
    id, title: value.title, description: value.description, status: value.status,
    assigneeId: value.assigneeId ?? null, dueDate: value.dueDate ?? null,
    position: value.position, propertyValues: value.propertyValues ?? {}, revision: taskRevision(value),
    ...(value.projectId !== undefined ? { projectId: value.projectId } : {}),
    ...(value.priority !== undefined ? { priority: value.priority } : {}),
    ...(value.estimate !== undefined ? { estimate: value.estimate } : {}),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}

/** Authorized detail read shared by HTTP and future read-only agent tools. */
export async function getTask(db: Firestore, workspace: DocumentReference, user: ServiceActor, id: string) {
  const ref = workspace.collection("tasks").doc(identifier(id));
  return db.runTransaction(async tx => {
    await member(tx, workspace, user.uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.deleting)
      throw new ApiError(404, "not_found", "Task not found.");
    const value = snapshot.data()!;
    return {
      ...taskView(snapshot.id, value),
      createdBy: typeof value.createdBy === "string" ? value.createdBy : null,
      createdAt: value.createdAt instanceof Timestamp ? value.createdAt.toMillis() : null,
      updatedAt: value.updatedAt instanceof Timestamp ? value.updatedAt.toMillis() : null,
    };
  });
}

export async function saveTask(
  db: Firestore,
  workspace: DocumentReference,
  user: ServiceActor,
  id: string | undefined,
  input: unknown,
) {
  const { value, operationId, expectedRevision } = taskMutationInput(input, !!id);
  const taskId = id === undefined ? undefined : identifier(id);
  const receipt = operationId
    ? workspace.collection("taskOperations").doc(hash(`${user.uid}:${operationId}`)) : null;
  const digest = receipt ? hash(JSON.stringify(canonical({ kind: taskId ? "update" : "create", taskId: taskId ?? null, expectedRevision: expectedRevision ?? null, value }))) : null;
  const requestedProperties = value.propertyValues;
  const ref = taskId ? workspace.collection("tasks").doc(taskId)
    : receipt ? workspace.collection("tasks").doc(`t_${receipt.id}`)
    : workspace.collection("tasks").doc();
  const task = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const [prior, previousReceipt] = await Promise.all([
      tx.get(ref), receipt ? tx.get(receipt) : Promise.resolve(null),
    ]);
    if (previousReceipt?.exists) {
      const recorded = previousReceipt.data()!;
      if (recorded.digest !== digest || recorded.uid !== user.uid || recorded.taskId !== ref.id)
        throw new ApiError(409, "operation_conflict", "An operation ID cannot be reused with different task changes.");
      if (!prior.exists || prior.data()?.deleting)
        throw new ApiError(409, "task_removed", "That task operation was already accepted, but the task has since been removed.");
      return taskView(ref.id, prior.data()!);
    }
    if (taskId && !prior.exists)
      throw new ApiError(404, "not_found", "Task not found.");
    if (!taskId && prior.exists)
      throw new ApiError(409, "operation_conflict", "This task identity is already in use.");
    if (prior.data()?.deleting)
      throw new ApiError(409, "deleting", "This task is being deleted.");
    const previous = prior.data() ?? {};
    if (["projectId", "priority", "estimate"].some(key => key in value)) requireProjects(db);
    const projectId = ("projectId" in value ? value.projectId : previous.projectId) as string | null | undefined;
    if (projectId && (projectId !== previous.projectId || !taskId)) {
      const project = await tx.get(workspace.collection("projects").doc(projectId));
      if (!project.exists || project.data()?.archived)
        throw new ApiError(400, "invalid_project", "Choose an active project in this workspace.");
    }
    if (expectedRevision !== undefined && taskRevision(previous) !== expectedRevision)
      throw new ApiError(409, "revision_conflict", "This task changed. Review the latest version before applying these changes.");
    const patch = { ...value };
    if ("propertyValues" in value) {
      const properties = await tx.get(workspace.collection("boardProperties"));
      const definitions = properties.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty);
      try {
        const changes = validatePropertyValues(requestedProperties, definitions, previous.propertyValues as Record<string, import("../model").PropertyValue> ?? {});
        for (const [key, selected] of Object.entries(changes)) {
          const definition = definitions.find(field => field.id === key)!;
          if (definition.projectId && definition.projectId !== projectId && selected !== null)
            throw new Error("That custom field belongs to another project.");
        }
        patch.propertyValues = {
          ...(previous.propertyValues as Record<string, unknown> ?? {}),
          ...changes,
        };
      } catch (error) { throw new ApiError(400, "invalid_input", (error as Error).message); }
      for (const [key, selected] of Object.entries(requestedProperties as Record<string, unknown>)) {
        if (selected === null) continue;
        const definition = definitions.find(field => field.id === key)!;
        if (definition.type === "person" && selected !== previous.propertyValues?.[key]) {
          const person = await tx.get(workspace.collection("members").doc(String(selected)));
          if (!person.exists) throw new ApiError(400, "invalid_person", "Choose a current workspace member.");
        }
        if (definition.type === "relation" && selected !== previous.propertyValues?.[key]) {
          const project = await tx.get(workspace.collection("projects").doc(String(selected)));
          if (!project.exists || project.data()?.archived) throw new ApiError(400, "invalid_project", "Choose an active workspace project.");
        }
      }
    }
    if (value.assigneeId) {
      const assignee = await tx.get(
        workspace.collection("members").doc(String(value.assigneeId)),
      );
      if (!assignee.exists)
        throw new ApiError(
          400,
          "invalid_input",
          "The assignee is no longer a member.",
        );
    }
    const revision = nextTaskRevision(previous);
    if (taskId) tx.update(ref, { ...patch, revision, updatedAt: now() });
    else
      tx.create(ref, {
        ...patch,
        revision,
        createdBy: user.uid,
        createdAt: now(),
        updatedAt: now(),
      });
    if (receipt) tx.create(receipt, { uid: user.uid, taskId: ref.id, digest, revision, createdAt: now() });
    return taskView(ref.id, { ...previous, ...patch, revision });
  });
  return task;
}

export async function saveBoardProperty(db: Firestore, workspace: DocumentReference, user: ServiceActor, id: string, input: unknown) {
  await rateLimit(db, user.uid, "board_property", 30);
  const data = object(input, ["name", "type", "options", "expectedRevision", "projectId"]);
  const expected = integer(data.expectedRevision, "Expected revision", 0, 1000000000);
  const propertyId = uuid(id);
  let definition: ReturnType<typeof propertyDefinition>;
  try { definition = propertyDefinition({ name: data.name, type: data.type, options: data.options, ...(data.projectId !== undefined ? {projectId:data.projectId} : {}) }); }
  catch (error) { throw new ApiError(400, "invalid_input", (error as Error).message); }
  if ((!db.capabilities?.normalizedFields) && (definition.projectId || !["text","select","multiSelect","date"].includes(definition.type)))
    throw new ApiError(400, "feature_unavailable", "This property type or scope requires PostgreSQL.");
  const property = await db.runTransaction(async tx => {
    await member(tx, workspace, user.uid);
    // Reading and incrementing the workspace serializes creates, including the cap and name check.
    const space = await tx.get(workspace);
    const rows = await tx.get(workspace.collection("boardProperties"));
    const properties = rows.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty);
    if (definition.projectId && !properties.some(property => property.id === propertyId)) {
      const project = await tx.get(workspace.collection("projects").doc(definition.projectId));
      if (!project.exists || project.data()?.archived) throw new ApiError(400, "invalid_project", "Choose an active workspace project.");
    }
    let next: BoardProperty;
    try { next = validatePropertyChange(properties, propertyId, expected, definition); }
    catch (error) { throw new ApiError(409, "property_conflict", (error as Error).message); }
    const { id: ignoredId, ...stored } = next;
    void ignoredId;
    tx.set(workspace.collection("boardProperties").doc(propertyId), { ...stored, updatedAt: now(), updatedBy: user.uid });
    tx.update(workspace, { boardPropertiesRevision: (space.data()?.boardPropertiesRevision ?? 0) + 1 });
    return next;
  });
  return property;
}

