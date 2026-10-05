import type { NoteContent } from "./model";

export type NoteHistory = {
  past: NoteContent[];
  present: NoteContent;
  future: NoteContent[];
  group?: string;
  editedAt: number;
};

export function sameContent(a: NoteContent, b: NoteContent): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory(content: NoteContent): NoteHistory {
  return { past: [], present: content, future: [], editedAt: 0 };
}

/** Snapshots are immutable note content; board tasks never enter this history. */
export function recordHistory(
  history: NoteHistory,
  content: NoteContent,
  group?: string,
  time = Date.now(),
): NoteHistory {
  if (sameContent(history.present, content)) return history;
  const coalesce = Boolean(
    group &&
    group === history.group &&
    time >= history.editedAt &&
    time - history.editedAt < 750 &&
    !history.future.length,
  );
  return {
    past: coalesce
      ? history.past
      : [...history.past, history.present].slice(-20),
    present: content,
    future: [],
    group,
    editedAt: time,
  };
}

export function undoHistory(history: NoteHistory): NoteHistory {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    editedAt: 0,
  };
}

export function redoHistory(history: NoteHistory): NoteHistory {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present].slice(-20),
    present: history.future[0],
    future: history.future.slice(1),
    editedAt: 0,
  };
}
