export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function object(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "invalid_input", "Expected an object.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    throw new ApiError(400, "invalid_input", "Unexpected field.");
  return data;
}
export function text(
  value: unknown,
  label: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /\u0000/.test(value)
  )
    throw new ApiError(
      400,
      "invalid_input",
      `${label} is invalid (maximum ${max} characters).`,
    );
  return empty ? value : value.trim();
}
export function identifier(value: unknown): string {
  const id = text(value, "Identifier", 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new ApiError(400, "invalid_input", "Invalid identifier.");
  return id;
}
export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new ApiError(400, "invalid_input", `${label} is invalid.`);
  return value;
}
export function taskInput(
  value: unknown,
  partial: boolean,
): Record<string, unknown> {
  const input = object(value, [
    "title",
    "description",
    "status",
    "assigneeId",
    "dueDate",
    "position",
  ]);
  const out: Record<string, unknown> = {};
  if (!partial || "title" in input) out.title = text(input.title, "Title", 200);
  if (!partial || "description" in input)
    out.description = text(input.description ?? "", "Description", 10000, true);
  if (!partial || "status" in input) {
    const status = input.status ?? "todo";
    if (!["todo", "doing", "done"].includes(status as string))
      throw new ApiError(400, "invalid_input", "Invalid status.");
    out.status = status;
  }
  if (!partial || "assigneeId" in input)
    out.assigneeId =
      input.assigneeId == null ? null : identifier(input.assigneeId);
  if (!partial || "dueDate" in input) {
    const date = input.dueDate;
    if (
      date != null &&
      (typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new ApiError(400, "invalid_input", "Invalid due date.");
    out.dueDate = date ?? null;
  }
  if (!partial || "position" in input)
    out.position = integer(input.position ?? 0, "Position", 0, 1000000000);
  if (!Object.keys(out).length)
    throw new ApiError(400, "invalid_input", "No changes supplied.");
  return out;
}
export function noteContent(value: unknown) {
  const data = object(value, ["blocks"]);
  if (!Array.isArray(data.blocks) || data.blocks.length > 1000)
    throw new ApiError(400, "invalid_input", "Invalid note blocks.");
  let length = 0;
  const blocks = data.blocks.map((value) => {
    const block = object(value, ["type", "text"]);
    if (!["paragraph", "heading", "bullet"].includes(block.type as string))
      throw new ApiError(400, "invalid_input", "Invalid block type.");
    const content = text(block.text, "Block text", 20000, true);
    length += content.length;
    return {
      type: block.type as "paragraph" | "heading" | "bullet",
      text: content,
    };
  });
  if (length > 100000)
    throw new ApiError(
      400,
      "invalid_input",
      "Note exceeds 100,000 characters.",
    );
  return { blocks };
}
