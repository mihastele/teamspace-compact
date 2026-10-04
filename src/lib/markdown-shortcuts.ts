import type { NoteBlock } from "./model";

/** Only exact prefixes convert while typing; ordinary prose stays untouched. */
export function markdownShortcut(text: string): NoteBlock | null {
  const heading = text.match(/^(#{1,6}) $/);
  if (heading)
    return {
      type: "heading",
      level: heading[1].length as NoteBlock["level"],
      text: "",
    };
  if (/^[-+*] $/.test(text)) return { type: "bullet", text: "" };
  if (/^\d+[.)] $/.test(text)) return { type: "ordered", text: "" };
  if (text === "> ") return { type: "quote", text: "" };
  if (/^(?:- )?\[[ xX]\] $/.test(text))
    return { type: "todo", checked: /[xX]/.test(text), text: "" };
  if (/^``` $/.test(text)) return { type: "code", text: "" };
  if (/^(---|\*\*\*|___) $/.test(text)) return { type: "divider", text: "" };
  return null;
}

export function blockMarkdown(block: NoteBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level ?? 1)} ${block.text}`;
    case "bullet":
      return `- ${block.text}`;
    case "ordered":
      return `1. ${block.text}`;
    case "quote":
      return block.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "todo":
      return `- [${block.checked ? "x" : " "}] ${block.text}`;
    case "divider":
      return "---";
    case "board":
      return block.boardView ? `[Shared workspace board: ${block.boardView.name.replace(/[\r\n\[\]]/g, " ")}]\n\nView settings: ${JSON.stringify(block.boardView)}` : "[Shared workspace board]";
    case "synced":
      return `[Synced block: note ${block.source?.noteId ?? "unavailable"}, block ${block.source?.blockId ?? "unavailable"}]`;
    case "code": {
      const runs = block.text.match(/`+/g) ?? [];
      const fence = "`".repeat(
        Math.max(3, ...runs.map((run) => run.length + 1)),
      );
      return `${fence}\n${block.text}\n${fence}`;
    }
    default:
      return block.text;
  }
}

export function markdownUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return url.startsWith("#") ? url : "";
  }
}
