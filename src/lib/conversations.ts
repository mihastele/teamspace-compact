import type { ConversationComment, Member } from "./model";

export type ConversationParent = "note" | "task";
export type CommentPacket = { operationId: string; body: string };
export type CommentDraft = { version: 1; body: string; pending: CommentPacket | null };
export function validCommentDraft(value: unknown): value is CommentDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as CommentDraft;
  if (draft.version !== 1 || typeof draft.body !== "string" || draft.body.length > 4000 || draft.body.includes("\0")) return false;
  if (draft.pending === null) return true;
  if (!draft.pending || draft.pending.body !== draft.body) return false;
  try { validateCommentPacket(draft.pending); return true; } catch { return false; }
}
export async function commentIdentity(uid: string, operationId: string, configured: boolean): Promise<string> {
  if (!configured) return operationId;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${operationId}`));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Deletion is terminal even if cached snapshots or acknowledgments arrive later. */
export function reconcileCommentSnapshots(rows: ConversationComment[], tombstones: Set<string>): ConversationComment[] {
  for (const row of rows) if (row.deleted) tombstones.add(row.id);
  return rows.map(row => tombstones.has(row.id) ? { ...row, body: "", mentions: [], deleted: true } : row);
}
/** A rejected retry cannot prove the original attempt never committed. */
export function canReleaseCommentRejection(wasPending: boolean, error: unknown): boolean {
  if (wasPending || typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = error.status;
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}
export type PreviewComment = ConversationComment & { operationId: string; digest: string };
export function mentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(/@\{([^{}]+)\}/g)].map(match => match[1]))];
}
export function commentMentions(body: string, members: Member[]) {
  const ids = mentionIds(body);
  if (ids.length > 10) throw new Error("Mention at most 10 members in one message.");
  return ids.map(uid => {
    const member = members.find(item => item.id === uid);
    if (!member) throw new Error("A mentioned member is no longer in this workspace.");
    return { uid, displayName: member.displayName };
  });
}
export function validateCommentPacket(packet: CommentPacket) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packet.operationId))
    throw new Error("Invalid message request identity.");
  if (typeof packet.body !== "string" || !packet.body.trim() || packet.body.length > 4000 || packet.body.includes("\0"))
    throw new Error("Write a message between 1 and 4,000 characters.");
}
/** Deterministic server-time order with ID ties; newest window is rendered oldest first. */
export function commentWindow(rows: ConversationComment[], count = 50): ConversationComment[] {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, count).reverse();
}
export async function postPreviewComment(rows: PreviewComment[], packet: CommentPacket, members: Member[], now: number): Promise<PreviewComment[]> {
  packet = { ...packet };
  validateCommentPacket(packet);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(packet.body));
  const digest = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const prior = rows.find(row => row.operationId === packet.operationId && row.authorId === "preview");
  if (prior) {
    if (prior.digest !== digest) throw new Error("A message request identity cannot be reused.");
    return rows;
  }
  const body = packet.body.trim();
  const comment: PreviewComment = {
    id: packet.operationId, operationId: packet.operationId, digest,
    body, authorId: "preview", authorName: "You (local preview)", createdAt: now, deleted: false,
    mentions: commentMentions(body, members),
  };
  return [...rows, comment];
}
export function deletePreviewComment(rows: PreviewComment[], commentId: string): PreviewComment[] {
  const prior = rows.find(row => row.id === commentId);
  if (!prior) throw new Error("This message no longer exists.");
  if (prior.authorId !== "preview") throw new Error("Only the author can delete this message.");
  return rows.map(row => row.id === commentId ? { ...row, body: "", mentions: [], deleted: true } : row);
}
