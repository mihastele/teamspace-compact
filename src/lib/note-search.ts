import type { Note } from "./model";

/** Search saved textual content; previews are plain text, never HTML. */
export function matchNote(
  note: Note,
  query: string,
): { matches: boolean; excerpt?: string } {
  const term = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!term) return { matches: true };
  if (note.title.replace(/\s+/g, " ").toLowerCase().includes(term))
    return { matches: true };
  const body = note.content.blocks
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ");
  const position = body.toLowerCase().indexOf(term);
  if (position < 0) return { matches: false };
  const start = Math.max(0, position - 30);
  const end = Math.min(body.length, start + 100);
  return {
    matches: true,
    excerpt: `${start ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`,
  };
}
