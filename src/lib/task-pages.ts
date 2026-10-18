import type { NoteContent, Task, TaskTemplate } from "./model";

export const taskBlockTypes = ["paragraph", "heading", "bullet", "ordered", "quote", "todo", "code", "divider", "markdown"] as const;

/** Legacy descriptions remain literal text, including Markdown-like prefixes. */
export function taskContent(task: Pick<Task, "description" | "content">): NoteContent {
  return structuredClone(task.content ?? { blocks: [{ type: "paragraph", text: task.description }] });
}

/** Compatibility excerpt for legacy search/cards/tools; the full body is exported. */
export function taskDescription(content: NoteContent): string {
  return content.blocks.map(block => block.text).join("\n").slice(0, 10000);
}

export function templateDefaults(task: Partial<Task> & { content: NoteContent }): TaskTemplate["defaults"] {
  return structuredClone({
    title: task.title ?? "", content: task.content, description: taskDescription(task.content),
    status: task.status ?? "todo", assigneeId: task.assigneeId || null,
    dueDate: task.dueDate || null, propertyValues: task.propertyValues ?? {},
    ...(task.projectId !== undefined ? { projectId: task.projectId || null } : {}),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(task.estimate !== undefined ? { estimate: task.estimate } : {}),
  });
}

export function applyTaskTemplate(template: TaskTemplate): TaskTemplate["defaults"] {
  const copy = structuredClone(template.defaults);
  copy.content.blocks = copy.content.blocks.map(block => ({ ...block, id: crypto.randomUUID() }));
  return copy;
}

/** Copies editable content only; identity, audit, attachments and conversation stay with the source. */
export function duplicateTask(task: Partial<Task>): TaskTemplate["defaults"] {
  const copy = templateDefaults({ ...task, content: taskContent({ description: task.description ?? "", content: task.content }) });
  const title = (task.title?.trim() || "Untitled task").slice(0, 193).replace(/[\uD800-\uDBFF]$/, "");
  copy.title = `${title} (copy)`;
  copy.content.blocks = copy.content.blocks.map(block => ({ ...block, id: crypto.randomUUID() }));
  return copy;
}
