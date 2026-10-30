import type { BoardProperty, PropertyValue, Member, Project } from "./model";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_PROPERTIES = 32;
export const propertyTypes = ["text", "longText", "number", "date", "checkbox", "select", "multiSelect", "person", "relation", "url"] as const;
export const optionColors = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
const entityId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a property object.");
  return value as Record<string, unknown>;
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /\u0000/.test(value))
    throw new Error("Property and option names must contain 1–80 characters.");
  return value.trim();
}
export function propertyDefinition(value: unknown, database = false): Omit<BoardProperty, "id" | "revision"> {
  const data = record(value);
  if (Object.keys(data).some(key => !["name", "type", "options", "projectId"].includes(key)))
    throw new Error("Unexpected property field.");
  if (!(propertyTypes as readonly string[]).includes(data.type as string) && !(database && ["email", "phone"].includes(data.type as string)))
    throw new Error("Invalid property type.");
  if (!Array.isArray(data.options) || data.options.length > 50)
    throw new Error("A property supports up to 50 options.");
  const options = data.options.map(value => {
    const option = record(value);
    if (Object.keys(option).some(key => !["id", "name", "color", "archived"].includes(key)) || !ID.test(String(option.id)))
      throw new Error("Invalid option identity.");
    if (option.color !== undefined && !optionColors.includes(option.color as typeof optionColors[number])) throw new Error("Invalid option color.");
    if (option.archived !== undefined && typeof option.archived !== "boolean") throw new Error("Invalid option archive state.");
    return { id: option.id as string, name: name(option.name), ...(option.color !== undefined ? {color:option.color as string} : {}), ...(option.archived !== undefined ? {archived:option.archived as boolean} : {}) };
  });
  if (new Set(options.map(option => option.id)).size !== options.length ||
      new Set(options.map(option => option.name.toLowerCase())).size !== options.length)
    throw new Error("Option names and identities must be unique.");
  if (!["select", "multiSelect"].includes(data.type as string) && options.length)
    throw new Error("Only select properties can contain options.");
  if (data.projectId !== undefined && data.projectId !== null && !entityId(data.projectId)) throw new Error("Invalid project scope.");
  return { name: name(data.name), type: data.type as BoardProperty["type"], options, ...(data.projectId !== undefined ? {projectId:data.projectId as string|null} : {}) };
}
export function validatePropertyChange(
  properties: readonly BoardProperty[], id: string, expectedRevision: number,
  definition: Omit<BoardProperty, "id" | "revision">,
): BoardProperty {
  if (!ID.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("Invalid property identity or revision.");
  const previous = properties.find(property => property.id === id);
  if ((previous?.revision ?? 0) !== expectedRevision)
    throw new Error("This property changed. Reopen it to review the latest version.");
  if (!previous && properties.length >= MAX_PROPERTIES)
    throw new Error(`This board supports up to ${MAX_PROPERTIES} custom properties.`);
  if (properties.some(property => property.id !== id && (property.projectId ?? null) === (definition.projectId ?? previous?.projectId ?? null) && property.name.toLowerCase() === definition.name.toLowerCase()))
    throw new Error("A property with this name already exists.");
  if (previous && (previous.type !== definition.type || previous.options.some(option => !definition.options.some(next => next.id === option.id))))
    throw new Error("Existing property types and option identities cannot be removed or replaced. Rename them or add a new property.");
  if (previous && definition.projectId !== undefined && (previous.projectId ?? null) !== definition.projectId) throw new Error("Existing property scope cannot change.");
  return { id, ...definition, ...(previous?.projectId !== undefined ? {projectId:previous.projectId} : {}), options:definition.options.map(option => {
    const prior=previous?.options.find(item=>item.id===option.id);
    return {...prior,...option};
  }), revision: expectedRevision + 1 };
}
export function propertyValuePatch(value: unknown): Record<string, PropertyValue> {
  const data = record(value);
  if (Object.keys(data).length > MAX_PROPERTIES) throw new Error("Too many custom property values.");
  for (const [id, item] of Object.entries(data)) {
    if (!ID.test(id) || !(item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER) || (typeof item === "string" && item.length <= 10000 && !/\u0000/.test(item)) ||
        (Array.isArray(item) && item.length <= 50 && item.every(option => typeof option === "string" && ID.test(option)))))
      throw new Error("Invalid custom property value.");
  }
  return data as Record<string, PropertyValue>;
}
export function validatePropertyValues(value: unknown, properties: readonly BoardProperty[], before: Record<string, PropertyValue> = {}): Record<string, PropertyValue> {
  const data = propertyValuePatch(value);
  for (const [id, item] of Object.entries(data)) {
    const property = properties.find(property => property.id === id);
    if (!property) throw new Error("This custom property no longer exists. Reopen the task.");
    if (item === null) continue;
    if (property.type === "number") {
      if (typeof item !== "number" || !Number.isFinite(item)) throw new Error(`Enter a number for ${property.name}.`);
      continue;
    }
    if (property.type === "checkbox") {
      if (typeof item !== "boolean") throw new Error(`Choose a checkbox value for ${property.name}.`);
      continue;
    }
    const old=before[id];
    const retained=Array.isArray(old)?old:typeof old === "string"?[old]:[];
    const allowed=(id:string)=>property.options.some(option=>option.id===id && (!option.archived || retained.includes(id)));
    if (property.type === "multiSelect") {
      if (!Array.isArray(item) || new Set(item).size !== item.length || item.some(option => !allowed(option)))
        throw new Error(`Choose valid options for ${property.name}.`);
    } else {
      if (typeof item !== "string") throw new Error(`Invalid value for ${property.name}.`);
      if (property.type === "select" && !allowed(item))
        throw new Error(`Choose a valid option for ${property.name}.`);
      if (["text","url","email","phone"].includes(property.type) && item.length>2000) throw new Error(`Value too long for ${property.name}.`);
      if (["person","relation"].includes(property.type) && !entityId(item)) throw new Error(`Choose a valid record for ${property.name}.`);
      if (property.type === "url") {
        let url:URL; try {url=new URL(item);} catch {throw new Error(`Enter a valid URL for ${property.name}.`);}
        if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new Error(`Enter an HTTP(S) URL without credentials for ${property.name}.`);
      }
      if (property.type === "date" && (item.startsWith("0000-") || !/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(item)) || new Date(item).toISOString().slice(0, 10) !== item))
        throw new Error(`Choose a valid date for ${property.name}.`);
    }
  }
  return data;
}
export function changedPropertyValues(before: Record<string, PropertyValue> = {}, after: Record<string, PropertyValue> = {}): Record<string, PropertyValue> {
  return Object.fromEntries(Object.entries(after).filter(([id, value]) => JSON.stringify(before[id] ?? null) !== JSON.stringify(value)));
}
export function propertyDisplay(property: BoardProperty, value: PropertyValue | undefined, members: readonly Member[] = [], projects: readonly Project[] = []): string {
  if (value == null) return "";
  if (property.type === "number") return typeof value === "number" ? String(value) : "";
  if (property.type === "checkbox") return typeof value === "boolean" ? value ? "Yes" : "No" : "";
  if (property.type === "person") return members.find(member=>member.id===value)?.displayName ?? "Unavailable member";
  if (property.type === "relation") return projects.find(project=>project.id===value)?.name ?? "Unavailable project";
  if (["text","longText","url","date","email","phone"].includes(property.type)) return typeof value === "string" ? value : "";
  const ids = Array.isArray(value) ? value : [value];
  return property.options.filter(option => ids.includes(option.id)).map(option => option.name).join(", ");
}
