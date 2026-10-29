import type { BlockContainmentRow } from "./generated/block-containment";

/** A complete, ordered snapshot of one workspace's containment graph. */
export type BlockPlacement = { id: BlockContainmentRow["id"]; parentId: BlockContainmentRow["parent_id"] };

/** Maintained application representation of the PostgreSQL containment row. */
export type StoredBlockPlacement = BlockPlacement & {
  workspaceId: BlockContainmentRow["workspace_id"];
  kind: BlockContainmentRow["kind"];
  position: BlockContainmentRow["position"];
  revision: BlockContainmentRow["revision"];
};

/**
 * Plan a move against a complete snapshot. `index` is measured among the
 * destination's children after the moving block is removed. A trusted storage
 * transaction must reload/validate the graph and serialize concurrent changes.
 */
export function moveBlock(
  snapshot: readonly BlockPlacement[],
  blockId: string,
  parentId: string | null,
  index: number,
): BlockPlacement[] {
  const blocks = new Map<string, BlockPlacement>();
  for (const block of snapshot) {
    if (!block.id || blocks.has(block.id)) throw new Error("Invalid block identity.");
    blocks.set(block.id, block);
  }
  // Validate the entire snapshot before trusting ancestor traversal. A corrupt
  // graph must not be made harder to diagnose by accepting another move.
  const validated = new Set<string>();
  for (const block of snapshot) {
    const path = new Set<string>();
    let current: BlockPlacement | undefined = block;
    while (current && !validated.has(current.id)) {
      if (path.has(current.id)) throw new Error("The block graph contains a cycle.");
      path.add(current.id);
      if (current.parentId === null) break;
      const parent = blocks.get(current.parentId);
      if (!parent) throw new Error("The block graph contains a missing parent.");
      current = parent;
    }
    for (const id of path) validated.add(id);
  }
  const moving = blocks.get(blockId);
  if (!moving || (parentId !== null && !blocks.has(parentId)))
    throw new Error("Block or destination is unavailable.");
  for (let ancestor = parentId; ancestor !== null; ancestor = blocks.get(ancestor)!.parentId)
    if (ancestor === blockId) throw new Error("A block cannot contain itself.");

  const remaining = snapshot.filter(block => block.id !== blockId);
  const siblings = remaining.filter(block => block.parentId === parentId);
  if (!Number.isInteger(index) || index < 0 || index > siblings.length)
    throw new Error("Invalid destination position.");
  const updated = { ...moving, parentId };
  if (index < siblings.length) {
    remaining.splice(remaining.indexOf(siblings[index]), 0, updated);
  } else if (siblings.length) {
    remaining.splice(remaining.indexOf(siblings[siblings.length - 1]) + 1, 0, updated);
  } else {
    remaining.push(updated);
  }
  return remaining;
}
