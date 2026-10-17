import "server-only";
import { Timestamp, type DocumentStore as Firestore, type DocumentReference } from "./document-store";
import { member, rateLimit, now, type ServiceActor } from "./service-context";
import { ApiError, identifier, integer, object, taskInput, uuid } from "./validation";
import { propertyDefinition, validatePropertyChange, validatePropertyValues } from "../board-properties";
import type { BoardProperty } from "../model";

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
      id: snapshot.id, title: value.title, description: value.description,
      status: value.status, assigneeId: value.assigneeId ?? null,
      dueDate: value.dueDate ?? null, position: value.position,
      propertyValues: value.propertyValues ?? {},
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
  const value = taskInput(input, !!id);
  const requestedProperties = value.propertyValues;
  const ref = id
    ? workspace.collection("tasks").doc(identifier(id))
    : workspace.collection("tasks").doc();
  const task = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const prior = id ? await tx.get(ref) : null;
    if (id && !prior?.exists)
      throw new ApiError(404, "not_found", "Task not found.");
    if (prior?.data()?.deleting)
      throw new ApiError(409, "deleting", "This task is being deleted.");
    if ("propertyValues" in value) {
      const properties = await tx.get(workspace.collection("boardProperties"));
      try {
        value.propertyValues = {
          ...(prior?.data()?.propertyValues ?? {}),
          ...validatePropertyValues(requestedProperties, properties.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty)),
        };
      } catch (error) { throw new ApiError(400, "invalid_input", (error as Error).message); }
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
    if (id) tx.update(ref, { ...value, updatedAt: now() });
    else
      tx.create(ref, {
        ...value,
        createdBy: user.uid,
        createdAt: now(),
        updatedAt: now(),
      });
    const previous = prior?.data() ?? {};
    return {
      id: ref.id,
      title: value.title ?? previous.title,
      description: value.description ?? previous.description,
      status: value.status ?? previous.status,
      assigneeId:
        "assigneeId" in value ? value.assigneeId : previous.assigneeId,
      dueDate: "dueDate" in value ? value.dueDate : previous.dueDate,
      position: value.position ?? previous.position,
      propertyValues: value.propertyValues ?? previous.propertyValues ?? {},
    };
  });
  return task;
}

export async function saveBoardProperty(db: Firestore, workspace: DocumentReference, user: ServiceActor, id: string, input: unknown) {
  await rateLimit(db, user.uid, "board_property", 30);
  const data = object(input, ["name", "type", "options", "expectedRevision"]);
  const expected = integer(data.expectedRevision, "Expected revision", 0, 1000000000);
  const propertyId = uuid(id);
  let definition: ReturnType<typeof propertyDefinition>;
  try { definition = propertyDefinition({ name: data.name, type: data.type, options: data.options }); }
  catch (error) { throw new ApiError(400, "invalid_input", (error as Error).message); }
  const property = await db.runTransaction(async tx => {
    await member(tx, workspace, user.uid);
    // Reading and incrementing the workspace serializes creates, including the cap and name check.
    const space = await tx.get(workspace);
    const rows = await tx.get(workspace.collection("boardProperties"));
    const properties = rows.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty);
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

