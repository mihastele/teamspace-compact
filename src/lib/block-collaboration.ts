import * as Y from "yjs";

// Bounds match the existing page collaboration protocol until integration
// defines and tests a separate per-block capacity policy.
export const MAX_BLOCK_STATE_BYTES = 350_000;
export const MAX_BLOCK_UPDATE_BYTES = 64_000;
export const MAX_BLOCK_TEXT_LENGTH = 100_000;

export class BlockCollaborationError extends Error {
  constructor(public readonly code: "invalid_state" | "invalid_update" | "missing_dependencies" | "capacity") {
    super(code);
  }
}

function content(doc: Y.Doc, errorCode: "invalid_state" | "invalid_update"): string {
  if (doc.store.pendingStructs || doc.store.pendingDs)
    throw new BlockCollaborationError("missing_dependencies");
  if ([...doc.share.keys()].some(key => key !== "text"))
    throw new BlockCollaborationError(errorCode);
  let text: Y.Text;
  try { text = doc.getText("text"); }
  catch { throw new BlockCollaborationError(errorCode); }
  // Yjs roots are decoded lazily; map entries can otherwise hide inside a
  // root subsequently interpreted as Y.Text.
  if (text._map.size !== 0) throw new BlockCollaborationError(errorCode);
  const delta = text.toDelta();
  if (delta.some((part: { insert?: unknown; attributes?: unknown }) => typeof part.insert !== "string" || part.attributes !== undefined))
    throw new BlockCollaborationError(errorCode);
  const value = text.toString();
  if (value.length > MAX_BLOCK_TEXT_LENGTH || value.includes("\0"))
    throw new BlockCollaborationError(errorCode);
  return value;
}

/** Validates and merges a complete update; callers must authorize and persist atomically. */
export function mergeBlockUpdate(state: Uint8Array, update: Uint8Array): { state: Uint8Array; text: string } {
  if (!(state instanceof Uint8Array) || state.byteLength > MAX_BLOCK_STATE_BYTES)
    throw new BlockCollaborationError("invalid_state");
  if (!(update instanceof Uint8Array) || update.byteLength > MAX_BLOCK_UPDATE_BYTES)
    throw new BlockCollaborationError("invalid_update");
  const doc = new Y.Doc();
  try {
    try { Y.applyUpdate(doc, state); }
    catch { throw new BlockCollaborationError("invalid_state"); }
    content(doc, "invalid_state");
    try { Y.applyUpdate(doc, update); }
    catch { throw new BlockCollaborationError("invalid_update"); }
    const text = content(doc, "invalid_update");
    const next = Y.encodeStateAsUpdate(doc);
    if (next.byteLength > MAX_BLOCK_STATE_BYTES) throw new BlockCollaborationError("capacity");
    return { state: next, text };
  } finally { doc.destroy(); }
}
