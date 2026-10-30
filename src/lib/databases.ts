import type { BoardProperty, NoteContent, PropertyValue } from "./model";
import { propertyTypes, propertyDefinition, validatePropertyChange, validatePropertyValues } from "./board-properties";
import { relationTarget, relationTargetIds } from "./database-relation-target";

export type DatabaseField = BoardProperty & { targetDatabaseId?: string; targetKind?: "database" | "task" | "project" };
export type DatabaseDefinition = { id: string; name: string; description: string; fields: DatabaseField[]; archived: boolean; revision: number };
export type DatabaseEntry = { id: string; databaseId: string; title: string; content: NoteContent; propertyValues: Record<string, PropertyValue>; archived: boolean; revision: number };
export type IncomingRelation = { entryId: string; databaseId: string; title: string; fieldId: string; fieldName: string; archived: boolean };
export type IncomingEntityRelation = { kind: "task" | "project"; entityId: string; title: string; fieldId: string; fieldName: string; archived: boolean };
export const databasePropertyTypes = [...propertyTypes, "email", "phone", "status"] as const;
export const statusGroups = [{id:"todo",name:"To do"},{id:"doing",name:"In progress"},{id:"done",name:"Complete"}] as const;
export const MAX_DATABASES = 64;
export const MAX_DATABASE_ENTRIES = 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Existing entry relations omit targetKind and retain their stored shape. */
export function databaseFields(input: unknown, before: DatabaseField[] = []): DatabaseField[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error("A database supports up to 32 properties.");
  const result: DatabaseField[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid database property.");
    const { id, targetDatabaseId, targetKind, ...definition } = item;
    if (typeof id !== "string" || !uuid.test(id) || result.some(field => field.id === id)) throw new Error("Invalid or duplicate property identity.");
    const previous = before.find(field => field.id === id);
    const parsed = propertyDefinition(definition, true);
    if ("projectId" in parsed) throw new Error("Database properties belong to their database.");
    if (parsed.type === "relation") {
      const target = relationTarget({ targetDatabaseId, targetKind });
      if (previous && JSON.stringify(relationTarget(previous)) !== JSON.stringify(target)) throw new Error("A relation's target cannot change.");
    } else if (targetDatabaseId !== undefined || targetKind !== undefined) throw new Error("Only relations have a target.");
    const field = validatePropertyChange(before, id, previous?.revision ?? 0, parsed);
    if (result.some(other => other.name.toLowerCase() === field.name.toLowerCase())) throw new Error("Property names must be unique.");
    result.push({ ...field, ...(targetDatabaseId ? { targetDatabaseId } : {}), ...(targetKind ? { targetKind } : {}) });
  }
  if (before.some(field => !result.some(next => next.id === field.id))) throw new Error("Existing properties cannot be removed. Rename them or add another property.");
  return result;
}

export function databaseValues(input: unknown, fields: DatabaseField[], before: Record<string, PropertyValue> = {}): Record<string, PropertyValue> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 32) throw new Error("Invalid property values.");
  const result: Record<string, PropertyValue> = {};
  for (const [id, value] of Object.entries(input)) {
    const field = fields.find(field => field.id === id);
    if (!field) throw new Error("This property no longer exists. Reopen the entry.");
    if (field.type === "relation") {
      result[id] = relationTargetIds(value, relationTarget(field));
    } else Object.assign(result, validatePropertyValues({ [id]: value }, fields, before));
  }
  return result;
}

export function databaseFieldInput(field: DatabaseField) {
  return { id: field.id, name: field.name, type: field.type, options: field.options, ...(field.targetDatabaseId ? { targetDatabaseId: field.targetDatabaseId } : {}), ...(field.targetKind ? { targetKind: field.targetKind } : {}) };
}
