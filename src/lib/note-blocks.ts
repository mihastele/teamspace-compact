import type { NoteContent } from "./model";

/** Copies the block, never the tasks referenced by a shared board embed. */
export function duplicateBlock(
  content: NoteContent,
  index: number,
): NoteContent {
  if (!Number.isInteger(index) || index < 0 || index >= content.blocks.length)
    return content;
  const blocks = [...content.blocks];
  blocks.splice(index + 1, 0, {
    ...blocks[index],
    ...(blocks[index].id ? { id: crypto.randomUUID() } : {}),
  });
  return { blocks };
}
