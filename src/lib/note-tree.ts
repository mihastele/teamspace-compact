import type { Note } from "./model";

export type NoteTreeRow = { note: Note; depth: number };

/** Use rendered traversal ancestry, including recovered roots, for collapsing. */
export function filterVisibleNoteTree(
  rows: NoteTreeRow[],
  isExpanded: (id: string) => boolean,
  matching?: ReadonlySet<string>,
): NoteTreeRow[] {
  const ancestors: string[] = [];
  return rows.filter(({ note, depth }) => {
    ancestors.length = depth;
    const visible = matching
      ? matching.has(note.id)
      : ancestors.every(isExpanded);
    ancestors[depth] = note.id;
    return visible;
  });
}

/** Parent links stay workspace-local; legacy documents without one are root pages. */
export function noteAncestors(notes: Note[], id: string): Note[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const seen = new Set([id]);
  const ancestors: Note[] = [];
  let parent = byId.get(id)?.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const note = byId.get(parent);
    if (!note) break;
    ancestors.push(note);
    parent = note.parentId;
  }
  return ancestors.reverse();
}

export function noteDescendants(notes: Note[], id: string): Set<string> {
  const children = new Map<string, Note[]>();
  for (const note of notes) {
    if (note.parentId) {
      const siblings = children.get(note.parentId) ?? [];
      siblings.push(note);
      children.set(note.parentId, siblings);
    }
  }
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    for (const child of children.get(current) ?? []) {
      if (child.id !== id && !found.has(child.id)) {
        found.add(child.id);
        pending.push(child.id);
      }
    }
  }
  return found;
}

export function assertNoteParent(
  notes: Note[],
  id: string | null,
  parentId: string | null,
): void {
  if (!parentId) return;
  if (id === parentId) throw new Error("A note cannot be its own parent.");
  const byId = new Map(notes.map((note) => [note.id, note]));
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current) {
    if (current === id || seen.has(current))
      throw new Error("A note cannot be moved inside its own descendants.");
    seen.add(current);
    const note = byId.get(current);
    if (!note)
      throw new Error("The parent note no longer exists in this workspace.");
    current = note.parentId ?? null;
  }
}

/** Iterative traversal keeps deep or malformed stored trees finite and visible. */
export function flattenNoteTree(notes: Note[]): NoteTreeRow[] {
  const ordered = [...notes].sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  const byId = new Map(ordered.map((note) => [note.id, note]));
  const children = new Map<string, Note[]>();
  const roots: Note[] = [];
  for (const note of ordered) {
    if (!note.parentId || !byId.has(note.parentId)) roots.push(note);
    else {
      const siblings = children.get(note.parentId) ?? [];
      siblings.push(note);
      children.set(note.parentId, siblings);
    }
  }
  const output: { note: Note; depth: number }[] = [];
  const seen = new Set<string>();
  function traverse(root: Note) {
    const pending = [{ note: root, depth: 0 }];
    while (pending.length) {
      const row = pending.pop()!;
      if (seen.has(row.note.id)) continue;
      seen.add(row.note.id);
      output.push(row);
      const nested = children.get(row.note.id) ?? [];
      for (let i = nested.length - 1; i >= 0; i--)
        pending.push({ note: nested[i], depth: row.depth + 1 });
    }
  }
  roots.forEach(traverse);
  // Display corrupt cyclic components rather than silently losing the user's pages.
  for (const note of ordered) if (!seen.has(note.id)) traverse(note);
  return output;
}
