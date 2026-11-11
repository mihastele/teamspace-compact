import type { DatabaseEntry } from "./databases";

export type RelationChoice = { id: string; title: string; selected: boolean; archived: boolean; unavailable: boolean; disabled: boolean };

/** Selected identities stay visible even when filtered out or absent from a target read. */
export function databaseRelationChoices(entries: readonly DatabaseEntry[], selected: readonly string[], search: string, targetArchived = false): RelationChoice[] {
  const selectedIds = new Set(selected);
  const targets = new Map(entries.map(entry => [entry.id, entry]));
  const query = search.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return [...new Set([...selected, ...targets.keys()])].flatMap(id => {
    const target = targets.get(id);
    const checked = selectedIds.has(id);
    const title = target?.title ?? `Unavailable entry (${id})`;
    if (!checked && !title.replace(/\s+/g, " ").toLocaleLowerCase().includes(query)) return [];
    return [{ id, title, selected: checked, archived: target?.archived ?? false, unavailable: !target, disabled: !checked && (!target || target.archived || targetArchived || selectedIds.size >= 50) }];
  }).sort((a, b) => Number(b.selected) - Number(a.selected) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function changeDatabaseRelation(selected: readonly string[], choice: RelationChoice, checked: boolean): string[] {
  if (!checked) return selected.filter(id => id !== choice.id);
  if (choice.disabled || choice.unavailable || choice.archived || selected.includes(choice.id) || new Set(selected).size >= 50) return [...selected];
  return [...selected, choice.id];
}
