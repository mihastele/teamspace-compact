import type { NoteContent } from "./model";
import { blockMarkdown } from "./markdown-shortcuts";

export function exportNoteMarkdown(
  title: string,
  content: NoteContent,
): { filename: string; markdown: string } {
  const cleanTitle =
    title.replace(/[\r\n\u0000-\u001f]/g, " ").trim() || "Untitled note";
  const slug =
    cleanTitle
      .replace(/[^\p{L}\p{N}._ -]/gu, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .slice(0, 100)
      .replace(/[. ]+$/g, "") || "untitled";
  // A fixed prefix avoids Windows device names and misleading leading paths.
  const filename = `note-${slug}.md`;
  const heading = cleanTitle.replace(/([\\`*_{}\[\]<>#])/g, "\\$1");
  const body = content.blocks.map(blockMarkdown).join("\n\n");
  return { filename, markdown: `# ${heading}\n\n${body}${body ? "\n" : ""}` };
}
