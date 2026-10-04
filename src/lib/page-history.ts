import type { Note, PageVersion } from "./model";

/** Keep acknowledged newer revisions when the shared listener delivers an older cache row.
 * Missing/deleting rows remain authoritative; this never recreates a deleted page. */
export function reconcilePageSnapshots(previous: Note[], incoming: Note[]): Note[] {
  const known = new Map(previous.map(note => [note.id, note]));
  return incoming.map(note => {
    const prior = known.get(note.id);
    return !(note as Note & { deleting?: boolean }).deleting && prior && prior.revision > note.revision ? prior : note;
  });
}

export const HISTORY_INTERVAL = 5 * 60 * 1000;
export const HISTORY_RETENTION = 30 * 24 * 60 * 60 * 1000;
export type LocalPageHistory = {
  checkpointAt: number;
  versions: PageVersion[];
  restores: Record<string, { signature: string }>;
};
const emptyHistory = (): LocalPageHistory => ({ checkpointAt: 0, versions: [], restores: {} });
export function visibleVersions(history: LocalPageHistory | undefined, now: number): PageVersion[] {
  return (history?.versions ?? []).filter(version => version.expiresAt === null || version.expiresAt > now).sort((a, b) => b.sourceRevision - a.sourceRevision);
}
function capture(history: LocalPageHistory, note: Note, kind: PageVersion["kind"], name: string | null, now: number): LocalPageHistory {
  const existing = history.versions.find(version => version.sourceRevision === note.revision);
  if (existing?.kind === "named") {
    if (kind === "named" && existing.name !== name) throw new Error("This revision already has a named version. Save another change to create a new version.");
    return history;
  }
  const version: PageVersion = {
    id: `r${note.revision}`, sourceRevision: note.revision, title: note.title,
    content: { blocks: note.content.blocks.map(block => ({ ...block })) },
    kind, name, capturedAt: existing?.capturedAt ?? now, capturedBy: "preview",
    capturedName: "Local explorer", expiresAt: kind === "named" ? null : now + HISTORY_RETENTION,
  };
  return { ...history, versions: [...history.versions.filter(item => item.id !== version.id), version] };
}
export function checkpointLocalPage(history: LocalPageHistory | undefined, note: Note, now: number): LocalPageHistory {
  const current = history ?? emptyHistory();
  const trimmed = { ...current, versions: visibleVersions(current, now) };
  if (history && now - current.checkpointAt < HISTORY_INTERVAL) return trimmed;
  return { ...capture(trimmed, note, "checkpoint", null, now), checkpointAt: now };
}
export function nameLocalVersion(history: LocalPageHistory | undefined, note: Note, expectedRevision: number, name: string, now: number): LocalPageHistory {
  if (!name.trim() || name.length > 100 || name.includes("\0")) throw new Error("Version name must be between 1 and 100 characters.");
  const current = history ?? emptyHistory();
  const existing = visibleVersions(current, now).find(version => version.sourceRevision === expectedRevision && version.kind === "named" && version.name === name.trim());
  if (existing) return current;
  if (note.revision !== expectedRevision) throw new Error("The page changed. Refresh your history review before saving a version.");
  return capture({ ...current, versions: visibleVersions(current, now) }, note, "named", name.trim(), now);
}
export function restoreLocalPage(history: LocalPageHistory | undefined, note: Note, versionId: string, expectedRevision: number, operationId: string, now: number): { note: Note; history: LocalPageHistory } {
  const current = history ?? emptyHistory();
  const signature = JSON.stringify([versionId, expectedRevision]);
  const prior = current.restores[operationId];
  if (prior) {
    if (prior.signature !== signature) throw new Error("Restore request identity conflicts. Refresh the history review.");
    return { note, history: current };
  }
  if (note.revision !== expectedRevision) throw new Error("The page changed. Refresh your history review before restoring.");
  if (note.revision >= 1000000000) throw new Error("The page has reached its version limit.");
  const version = visibleVersions(current, now).find(item => item.id === versionId);
  if (!version) throw new Error("This version is missing or expired.");
  const backedUp = capture({ ...current, versions: visibleVersions(current, now) }, note, "before_restore", null, now);
  const next: Note = { ...note, title: version.title, content: { blocks: version.content.blocks.map(block => ({ ...block })) }, revision: note.revision + 1 };
  return { note: next, history: { ...backedUp, checkpointAt: now, restores: { ...backedUp.restores, [operationId]: { signature } } } };
}
