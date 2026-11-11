/** Relation targets use one kind per property. */
export type DatabaseRelationTarget =
  | { kind: "database"; databaseId: string }
  | { kind: "task" }
  | { kind: "project" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;

/** Interpret existing entry-only definitions without modifying their stored form. */
export function relationTarget(input: unknown): DatabaseRelationTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid relation target.");
  const { targetKind, targetDatabaseId } = input as Record<string, unknown>;
  if (targetKind === undefined || targetKind === "database") {
    if (typeof targetDatabaseId !== "string" || !uuid.test(targetDatabaseId)) throw new Error("Choose a target database.");
    return { kind: "database", databaseId: targetDatabaseId };
  }
  if ((targetKind === "task" || targetKind === "project") && targetDatabaseId === undefined)
    return { kind: targetKind };
  throw new Error("Choose one relation target kind.");
}

/** Validate identities only; trusted services must also authorize and check existence. */
export function relationTargetIds(value: unknown, target: DatabaseRelationTarget): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 50 || value.some(id =>
    typeof id !== "string" || !(target.kind === "database" ? uuid : identifier).test(id),
  ) || new Set(value).size !== value.length) throw new Error("Choose up to 50 distinct valid relation targets.");
  return [...value];
}
