import type { BoardProperty, PropertyValue } from "./model";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_PROPERTIES = 32;
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
export function propertyDefinition(value: unknown): Omit<BoardProperty, "id" | "revision"> {
  const data = record(value);
  if (Object.keys(data).some(key => !["name", "type", "options"].includes(key)))
    throw new Error("Unexpected property field.");
  if (!["text", "select", "multiSelect", "date"].includes(data.type as string))
    throw new Error("Invalid property type.");
  if (!Array.isArray(data.options) || data.options.length > 50)
    throw new Error("A property supports up to 50 options.");
  const options = data.options.map(value => {
    const option = record(value);
    if (Object.keys(option).some(key => !["id", "name"].includes(key)) || !ID.test(String(option.id)))
      throw new Error("Invalid option identity.");
    return { id: option.id as string, name: name(option.name) };
  });
  if (new Set(options.map(option => option.id)).size !== options.length ||
      new Set(options.map(option => option.name.toLowerCase())).size !== options.length)
    throw new Error("Option names and identities must be unique.");
  if (["text", "date"].includes(data.type as string) && options.length)
    throw new Error("Text and date properties cannot contain options.");
  return { name: name(data.name), type: data.type as BoardProperty["type"], options };
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
  if (properties.some(property => property.id !== id && property.name.toLowerCase() === definition.name.toLowerCase()))
    throw new Error("A property with this name already exists.");
  if (previous && (previous.type !== definition.type || previous.options.some(option => !definition.options.some(next => next.id === option.id))))
    throw new Error("Existing property types and option identities cannot be removed or replaced. Rename them or add a new property.");
  return { id, ...definition, revision: expectedRevision + 1 };
}
export function propertyValuePatch(value: unknown): Record<string, PropertyValue> {
  const data = record(value);
  if (Object.keys(data).length > MAX_PROPERTIES) throw new Error("Too many custom property values.");
  for (const [id, item] of Object.entries(data)) {
    if (!ID.test(id) || !(item === null || (typeof item === "string" && item.length <= 2000 && !/\u0000/.test(item)) ||
        (Array.isArray(item) && item.length <= 50 && item.every(option => typeof option === "string" && ID.test(option)))))
      throw new Error("Invalid custom property value.");
  }
  return data as Record<string, PropertyValue>;
}
export function validatePropertyValues(value: unknown, properties: readonly BoardProperty[]): Record<string, PropertyValue> {
  const data = propertyValuePatch(value);
  for (const [id, item] of Object.entries(data)) {
    const property = properties.find(property => property.id === id);
    if (!property) throw new Error("This custom property no longer exists. Reopen the task.");
    if (item === null) continue;
    if (property.type === "multiSelect") {
      if (!Array.isArray(item) || new Set(item).size !== item.length || item.some(option => !property.options.some(allowed => allowed.id === option)))
        throw new Error(`Choose valid options for ${property.name}.`);
    } else {
      if (typeof item !== "string") throw new Error(`Invalid value for ${property.name}.`);
      if (property.type === "select" && !property.options.some(option => option.id === item))
        throw new Error(`Choose a valid option for ${property.name}.`);
      if (property.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(item)) || new Date(item).toISOString().slice(0, 10) !== item))
        throw new Error(`Choose a valid date for ${property.name}.`);
    }
  }
  return data;
}
export function changedPropertyValues(before: Record<string, PropertyValue> = {}, after: Record<string, PropertyValue> = {}): Record<string, PropertyValue> {
  return Object.fromEntries(Object.entries(after).filter(([id, value]) => JSON.stringify(before[id] ?? null) !== JSON.stringify(value)));
}
export function propertyDisplay(property: BoardProperty, value: PropertyValue | undefined): string {
  if (value == null) return "";
  if (property.type === "text" || property.type === "date") return typeof value === "string" ? value : "";
  const ids = Array.isArray(value) ? value : [value];
  return property.options.filter(option => ids.includes(option.id)).map(option => option.name).join(", ");
}
