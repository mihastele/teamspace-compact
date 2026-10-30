import "server-only";
import type { DatabaseDefinition, DatabaseEntry } from "../databases";
import { databaseFields, databaseValues, MAX_DATABASES, MAX_DATABASE_ENTRIES } from "../databases";
import { relationTarget } from "../database-relation-target";
import { taskBlockTypes } from "../task-pages";
import type { DocumentStore, DocumentReference, StoreData } from "./document-store";
import { member, rateLimit, now, hash, type ServiceActor } from "./service-context";
import { ApiError, object, text, integer, uuid, noteContent } from "./validation";
import { requireProjects } from "./project-service";

const definitionView = (id: string, row: StoreData): DatabaseDefinition => ({ id, name: row.name, description: row.description, fields: row.fields, archived: row.archived, revision: row.revision });
const entryView = (id: string, row: StoreData): DatabaseEntry => ({ id, databaseId: row.databaseId, title: row.title, content: row.content, propertyValues: row.propertyValues, archived: row.archived, revision: row.revision });
function canonical(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`;
  if (input && typeof input === "object") return "{" + Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",") + "}";
  return JSON.stringify(input);
}
function invalid(error: unknown): never { throw new ApiError(400, "invalid_input", (error as Error).message); }

export async function readDatabases(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor) {
  requireProjects(db);
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const rows = await tx.get(workspace.collection("databases").limit(MAX_DATABASES + 1));
    return { databases: rows.docs.slice(0, MAX_DATABASES).map(row => definitionView(row.id, row.data())), truncated: rows.size > MAX_DATABASES };
  });
}

export async function readDatabase(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id: string, cursor?:string, summary=false) {
  requireProjects(db); uuid(id);
  if(cursor)uuid(cursor);
  return db.runTransaction(async tx => {
    await member(tx, workspace, actor.uid);
    const definition = await tx.get(workspace.collection("databases").doc(id));
    if (!definition.exists) throw new ApiError(404, "not_found", "Database not found.");
    let query=workspace.collection("databaseEntries").where("databaseId","==",id).orderBy("entryKey","desc");
    if(cursor)query=query.where("entryKey","<",cursor);
    if(summary)query=query.select("databaseId","title","archived","revision","entryKey");
    const rows=await tx.get(query.limit(summary?101:21));
    const entries:DatabaseEntry[]=[];
    let bytes=0;
    for(const row of rows.docs.slice(0,summary?100:20)){
      const item=entryView(row.id,{...row.data(),...(summary?{content:{blocks:[]},propertyValues:{}}:{})});
      const size=Buffer.byteLength(JSON.stringify(item));
      if(entries.length&&bytes+size>1000000)break;
      entries.push(item);bytes+=size;
    }
    const truncated=rows.size>entries.length;
    return {database:definitionView(id,definition.data()!),entries,truncated,nextCursor:truncated?entries.at(-1)?.id??null:null};
  });
}

export async function readDatabaseEntry(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, id: string) {
  requireProjects(db); uuid(id);
  if (!db.databaseEntryRead) throw new ApiError(503, "feature_unavailable", "Database entry reads are unavailable.");
  const result = await db.databaseEntryRead({p_workspace:workspace.id,p_uid:actor.uid,p_entry:id});
  if (result.error) {
    const code=String(result.error);
    const status=code==="not_found"?404:code==="policy_mismatch"?503:403;
    throw new ApiError(status,code,code==="not_found"?"Entry not found.":"Database access is unavailable. Refresh your session or ask the administrator to check access.");
  }
  return {entry:entryView(id,result.entry),incoming:result.incoming,truncated:result.truncated};
}

export async function saveDatabaseRecord(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor, kind: "databases" | "databaseEntries", id: string, input: unknown) {
  requireProjects(db); uuid(id);
  await rateLimit(db, actor.uid, "database_write", 60);
  const data = object(input, kind === "databases" ? ["name", "description", "fields", "archived", "expectedRevision", "operationId"] : ["databaseId", "title", "content", "propertyValues", "archived", "expectedRevision", "operationId"]);
  const expected = integer(data.expectedRevision, "Expected revision", 0, 1000000000);
  const operationId = uuid(data.operationId);
  if (typeof data.archived !== "boolean") throw new ApiError(400, "invalid_input", "Choose an archive state.");
  const digest = hash(canonical({ kind, id, ...data }));
  const ref = workspace.collection(kind).doc(id);
  const receipt = workspace.collection("databaseOperations").doc(hash(`${actor.uid}:${operationId}`));
  return db.runTransaction(async tx => {
    const space = await member(tx, workspace, actor.uid);
    const previous = await tx.get(ref);
    const accepted = await tx.get(receipt);
    if (accepted.exists) {
      if (accepted.data()!.digest !== digest) throw new ApiError(409, "operation_conflict", "This save identity was already used for different changes.");
      if (!previous.exists) throw new ApiError(404, "not_found", "This record no longer exists.");
      return kind === "databases" ? definitionView(id, previous.data()!) : entryView(id, previous.data()!);
    }
    if ((previous.data()?.revision ?? 0) !== expected) throw new ApiError(409, "revision_conflict", "This record changed. Your draft is preserved; reopen the latest version before saving again.");
    let next: StoreData;
    if (kind === "databases") {
      const name = text(data.name, "Database name", 80);
      const description = text(data.description, "Description", 2000, true);
      let fields: DatabaseDefinition["fields"]; try { fields = databaseFields(data.fields, previous.data()?.fields ?? []); } catch (error) { invalid(error); }
      const definitions = await tx.get(workspace.collection("databases").limit(MAX_DATABASES + 1));
      if (!previous.exists && definitions.size >= MAX_DATABASES) throw new ApiError(409, "database_limit", "A workspace supports 64 databases, including archives.");
      if (definitions.docs.some(row => row.id !== id && row.data().name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "name_conflict", "A database with this name already exists.");
      for (const field of fields!) if (field.targetDatabaseId && field.targetDatabaseId !== id) {
        const target = await tx.get(workspace.collection("databases").doc(field.targetDatabaseId));
        const retained = previous.data()?.fields?.some((old: DatabaseDefinition["fields"][number]) => old.id === field.id && old.targetDatabaseId === field.targetDatabaseId);
        if (!target.exists || (!retained && target.data()?.archived)) throw new ApiError(400, "invalid_target", "Choose an active target database in this workspace.");
      }
      next = { name, description, fields: fields!, archived: data.archived };
    } else {
      const databaseId = uuid(data.databaseId);
      if (previous.exists && previous.data()?.databaseId !== databaseId) throw new ApiError(400, "invalid_database", "An entry cannot move between databases.");
      const definition = await tx.get(workspace.collection("databases").doc(databaseId));
      if (!definition.exists) throw new ApiError(404, "not_found", "Database not found.");
      if (definition.data()!.archived) throw new ApiError(409, "database_archived", "Restore this database before editing its entries.");
      const title = text(data.title, "Entry title", 200);
      const content = noteContent(data.content);
      if (content.blocks.some(block => !(taskBlockTypes as readonly string[]).includes(block.type))) throw new ApiError(400, "invalid_input", "Database entries support text blocks, not workspace embeds.");
      let propertyValues: DatabaseEntry["propertyValues"]; try { propertyValues = databaseValues(data.propertyValues, definition.data()!.fields, previous.data()?.propertyValues); } catch (error) { invalid(error); }
      const fields = definition.data()!.fields as DatabaseDefinition["fields"];
      for (const field of fields) {
        const value = propertyValues![field.id];
        if (field.type === "person" && value && value !== previous.data()?.propertyValues?.[field.id]) {
          if (!(await tx.get(workspace.collection("members").doc(String(value)))).exists) throw new ApiError(400, "invalid_person", "Choose a current workspace member.");
        }
        if (field.type !== "relation" || !Array.isArray(value)) continue;
        const targetKind = relationTarget(field);
        const targetDatabase = targetKind.kind === "database" ? await tx.get(workspace.collection("databases").doc(targetKind.databaseId)) : null;
        for (const targetId of value) {
          const collection = targetKind.kind === "database" ? "databaseEntries" : targetKind.kind === "task" ? "tasks" : "projects";
          const target = await tx.get(workspace.collection(collection).doc(targetId));
          const retained = previous.data()?.propertyValues?.[field.id]?.includes(targetId);
          if (!target.exists || target.data()?.deleting || (targetKind.kind === "database" && target.data()?.databaseId !== targetKind.databaseId) || (!retained && (target.data()?.archived || targetDatabase?.data()?.archived))) throw new ApiError(400, "invalid_relation", "Choose active targets in this workspace. Existing archived links may be retained or cleared.");
        }
      }
      if (!previous.exists) {
        const rows = await tx.get(workspace.collection("databaseEntries").where("databaseId", "==", databaseId).limit(MAX_DATABASE_ENTRIES + 1));
        if (rows.size >= MAX_DATABASE_ENTRIES) throw new ApiError(409, "entry_limit", "This database supports 1,000 entries, including archives.");
      }
      next = { databaseId, entryKey:id, title, content, propertyValues: propertyValues!, archived: data.archived };
    }
    next = { ...previous.data(), ...next, revision: expected + 1, updatedAt: now(), updatedBy: actor.uid };
    if (previous.exists) tx.set(ref, next); else tx.create(ref, next);
    tx.create(receipt, { digest, kind, recordId: id, uid: actor.uid, revision: expected + 1, createdAt: now() });
    tx.update(workspace, { databasesRevision: (space.data()?.databasesRevision ?? 0) + 1 });
    return kind === "databases" ? definitionView(id, next) : entryView(id, next);
  });
}
