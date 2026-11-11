import { relationTargetIds } from "./database-relation-target";

export type EntityRelationScope = "task" | "project";
export type EntityRelationField = { id: string; name: string; scope: EntityRelationScope; targetDatabaseId: string; revision: number };
export type EntityRelationValues = Record<string, string[]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Shape validation only; services must check field ownership and target access. */
export function entityRelationValues(input: unknown): EntityRelationValues {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 32) throw new Error("Invalid database relations.");
  return Object.fromEntries(Object.entries(input).map(([field, value]) => {
    if (!uuid.test(field)) throw new Error("Invalid relation property.");
    const ids = relationTargetIds(value, {kind:"database",databaseId:""});
    if (ids === null) throw new Error("Relation values must be arrays.");
    return [field,ids];
  }));
}
