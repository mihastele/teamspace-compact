import "server-only";
import type { BoardProperty } from "../model";
import { validatePropertyValues } from "../board-properties";
import { builtinFields, queryOperators, validateTicketQuery } from "../ticket-query";
import type { DocumentStore, DocumentReference, StoreData, Transaction } from "./document-store";
import { member, type ServiceActor } from "./service-context";
import { getProject, requireProjects } from "./project-service";
import { getTask } from "./task-service";
import { getConversation } from "./conversation-service";
import { queryTickets } from "./ticket-view-service";
import { ApiError, identifier, object, taskInput, text } from "./validation";
import { agentToolNames, type AgentTool, type AgentToolName } from "./agent-provider";

const outputLimit = 64_000;
const idSchema = { type: "string", maxLength: 128 };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const nullableId = { anyOf: [idSchema, { type: "null" }] };
const querySchema = schema({
  version: { type: "integer", const: 1 }, timeZone: { type: "string", maxLength: 80 },
  filter: { type: "object", description: 'A leaf {field,op,value} or group {and:[filters]} / {or:[filters]}; {and:[]} matches all. At most 32 nodes, depth 4. Builtin fields are title, description, status, priority, assigneeId, projectId, dueDate, estimate, position; custom fields use custom:<returned field UUID>. The catalog supplies operators by type. isEmpty/isNotEmpty omit value; in/notIn/containsAny/containsAll take arrays, between takes two dates. Date values are YYYY-MM-DD or @today±N. Person @me and projectId @project are resolved by the server.' },
  sort: { type: "array", maxItems: 3, items: schema({ field: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] } }, ["field", "direction"]) },
}, ["version", "timeZone", "filter", "sort"]);
const proposalSchema = schema({
  title: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 10000 },
  status: { type: "string", enum: ["todo", "doing", "done"] }, priority: { type: "string", enum: ["none", "low", "medium", "high", "urgent"] },
  projectId: nullableId, assigneeId: nullableId,
  dueDate: { anyOf: [{ type: "string", description: "YYYY-MM-DD calendar date" }, { type: "null" }] },
  estimate: { anyOf: [{ type: "number", minimum: 0, maximum: 1000000 }, { type: "null" }] },
  position: { type: "integer", minimum: 0, maximum: 1000000000 },
  propertyValues: { type: "object", description: "Returned field UUID keys mapped to typed values: strings, numbers, booleans, null, or option UUID arrays. Use the catalog for types and options." },
}, ["title"]);
/** Runtime validators remain authoritative on every compatible endpoint. */
export const readOnlyAgentTools: readonly AgentTool[] = [
  { name: "search_projects", description: "List up to 20 projects and members, optionally matching exact name. Returns the custom-field catalog. Supply a returned fieldId to fetch its options. Truncation is explicit; these are not workspace totals.", parameters: schema({ name: { type: "string", maxLength: 200 }, memberName: { type: "string", maxLength: 200 }, fieldId: idSchema }) },
  { name: "search_tickets", description: "Search tickets with the application's version 1 typed query AST, explicit IANA timeZone and optional keyset cursor. Read field and option IDs from search_projects first. Returns at most 20 summaries, never SQL.", parameters: schema({ query: querySchema, cursor: { type: "string", maxLength: 300000 }, projectId: idSchema }, ["query"]) },
  { name: "get_project", description: "Read a project whose ID was returned by a tool. Archived projects remain readable.", parameters: schema({ id: idSchema }, ["id"]) },
  { name: "get_ticket", description: "Read a returned ticket ID, its custom values and the latest ten comment excerpts. Truncated values are marked.", parameters: schema({ id: idSchema }, ["id"]) },
  { name: "summarize_project", description: "Read up to 20 project tickets and observed status counts. Results are a live sample, not totals or inferred blockers. Supply timeZone explicitly.", parameters: schema({ id: idSchema, timeZone: { type: "string", maxLength: 100 } }, ["id", "timeZone"]) },
  { name: "summarize_tickets", description: "Read up to 20 already-returned ticket IDs and their observed status counts. Cite IDs and distinguish inferred blockers from facts.", parameters: schema({ ids: { type: "array", items: idSchema, minItems: 1, maxItems: 20 } }, ["ids"]) },
  { name: "propose_ticket_plan", description: "Validate up to 20 proposed new tickets, including typed custom values, without saving anything. Use only returned project/member/field/option IDs. Human review and confirmed writes are a later step.", parameters: schema({ items: { type: "array", minItems: 1, maxItems: 20, items: proposalSchema } }, ["items"]) },
];

type Kind = "projects" | "tasks" | "members" | "fields" | "options";
function invalid(code = "invalid_tool_input"): never { throw new ApiError(400, code, code); }
function clip(value: unknown, max: number) {
  const source = typeof value === "string" ? value : "";
  return { text: source.slice(0, max), truncated: source.length > max };
}
function counts(tasks: StoreData[]) {
  const status: Record<string, number> = {};
  for (const task of tasks) if (typeof task.status === "string") status[task.status] = (status[task.status] ?? 0) + 1;
  return { observedTickets: tasks.length, status };
}

/**
 * One run's read capabilities. Construct only with server-authenticated authority
 * and a policy-guarded store; never accept these from tool arguments. This is not
 * an authentication boundary or a persisted run. The worker must reauthenticate
 * the account on execution/resumption and persist provenance with its checkpoint.
 */
export function createReadOnlyAgentTools(db: DocumentStore, workspace: DocumentReference, actor: ServiceActor) {
  requireProjects(db);
  const seen: Record<Kind, Set<string>> = { projects: new Set(), tasks: new Set(), members: new Set(), fields: new Set(), options: new Set() };
  const known = (kind: Kind, value: unknown) => {
    const id = identifier(value);
    if (!seen[kind].has(id)) invalid("unseen_reference");
    return id;
  };
  const summary = (task: StoreData) => {
    const title = clip(task.title, 200), description = clip(task.description, 500);
    return { id: task.id, title: title.text, description: description.text, status: task.status,
      projectId: task.projectId ?? null, assigneeId: task.assigneeId ?? null, dueDate: task.dueDate ?? null,
      priority: task.priority ?? "none", estimate: task.estimate ?? null, revision: task.revision ?? 0,
      truncated: title.truncated || description.truncated };
  };
  const definitions = async (tx: Transaction) => {
    const rows = await tx.get(workspace.collection("boardProperties").limit(33));
    if (rows.size > 32) invalid("field_catalog_limit");
    return rows.docs.map(row => ({ ...row.data(), id: row.id }) as BoardProperty);
  };
  async function catalog(data: Record<string, unknown>) {
    const name = data.name === undefined ? undefined : text(data.name, "Project name", 200);
    const memberName = data.memberName === undefined ? undefined : text(data.memberName, "Member name", 200);
    const fieldId = data.fieldId === undefined ? undefined : known("fields", data.fieldId);
    const result = await db.runTransaction(async tx => {
      await member(tx, workspace, actor.uid);
      let projects = workspace.collection("projects").orderBy("name");
      let members = workspace.collection("members").orderBy("displayName");
      if (name) projects = projects.where("name", "==", name);
      if (memberName) members = members.where("displayName", "==", memberName);
      const [projectRows, memberRows, fields] = await Promise.all([tx.get(projects.limit(21)), tx.get(members.limit(21)), definitions(tx)]);
      const field = fieldId ? fields.find(field => field.id === fieldId) : undefined;
      if (fieldId && !field) invalid("field_unavailable");
      return {
        projects: projectRows.docs.slice(0, 20).map(row => ({ id: row.id, name: row.data().name, archived: row.data().archived === true, revision: row.data().revision })),
        members: memberRows.docs.slice(0, 20).map(row => ({ id: row.id, displayName: row.data().displayName })),
        fields: fields.map(field => ({ id: field.id, name: field.name, type: field.type, projectId: field.projectId ?? null, revision: field.revision, operators: queryOperators(field.type) })),
        builtinFields: Object.entries(builtinFields).map(([field, type]) => ({ field, type, operators: queryOperators(type) })),
        ...(field ? { field } : {}), projectResultsTruncated: projectRows.size > 20, memberResultsTruncated: memberRows.size > 20,
        matching: "exact_name", initiatorId: actor.uid,
      };
    });
    return result;
  }
  async function ticketDetail(id: string) {
    const task = await getTask(db, workspace, actor, id);
    const comments = await getConversation(db, workspace, actor, "tasks", id);
    const truncatedFields: string[] = [];
    const propertyValues = Object.fromEntries(Object.entries(task.propertyValues).map(([key, value]) => {
      if (typeof value === "string" && value.length > 256) { truncatedFields.push(key); return [key, value.slice(0, 256)]; }
      return [key, value];
    }));
    const description = clip(task.description, 10_000);
    return { ...summary(task), description: description.text, descriptionTruncated: description.truncated,
      truncated: clip(task.title, 200).truncated || description.truncated || truncatedFields.length > 0 || comments.length > 10 || comments.some(comment => clip(comment.body, 1000).truncated),
      propertyValues, truncatedFields,
      comments: comments.slice(-10).map(comment => ({ id: comment.id, body: clip(comment.body, 1000), authorId: comment.authorId, createdAt: comment.createdAt, deleted: comment.deleted })),
      commentsMayBeTruncated: comments.length > 10 };
  }
  function checkFilterReferences(value: unknown, fields: BoardProperty[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    for (const key of ["and", "or"]) if (Array.isArray(node[key])) for (const child of node[key]) checkFilterReferences(child, fields);
    if (typeof node.field !== "string") return;
    let kind: Kind | undefined;
    if (node.field === "projectId") kind = "projects";
    if (node.field === "assigneeId") kind = "members";
    if (node.field.startsWith("custom:")) {
      const id = known("fields", node.field.slice(7)), field = fields.find(field => field.id === id);
      if (field?.type === "relation") kind = "projects";
      if (field?.type === "person") kind = "members";
      if (field?.type === "select" || field?.type === "multiSelect") kind = "options";
    }
    if (kind) for (const item of Array.isArray(node.value) ? node.value : [node.value]) {
      if (item !== null && item !== undefined && item !== "@me" && item !== "@project") known(kind, item);
    }
  }
  async function search(data: Record<string, unknown>) {
    // Validate the shared AST first (including its depth bound) before traversing
    // references. queryTickets will validate it again against the live schema.
    const fields = await db.runTransaction(async tx => { await member(tx, workspace, actor.uid); return definitions(tx); });
    let query;
    try { query = validateTicketQuery(data.query, fields); } catch { return invalid(); }
    checkFilterReferences(query.filter, fields);
    for (const sort of query.sort) if (sort.field.startsWith("custom:")) known("fields", sort.field.slice(7));
    const projectId = data.projectId === undefined ? undefined : known("projects", data.projectId);
    const page = await queryTickets(db, workspace, actor, { query, limit: 20, ...(data.cursor !== undefined ? { cursor: data.cursor } : {}), ...(projectId ? { projectId } : {}) });
    const cursorTooLarge = page.nextCursor !== null && page.nextCursor.length > 16_000;
    return { tasks: page.tasks.map(summary), nextCursor: cursorTooLarge ? null : page.nextCursor,
      resultsTruncated: page.nextCursor !== null, cursorUnavailable: cursorTooLarge, timeZone: page.timeZone,
      schema: page.schema };
  }
  async function plan(data: Record<string, unknown>) {
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 20) invalid();
    const items = data.items.map(value => taskInput(value, false));
    return db.runTransaction(async tx => {
      await member(tx, workspace, actor.uid);
      const fields = await definitions(tx);
      for (const item of items) {
        const projectIds = new Set<string>();
        const memberIds = new Set<string>();
        if (item.projectId) projectIds.add(known("projects", item.projectId));
        if (item.assigneeId) memberIds.add(known("members", item.assigneeId));
        for (const [id, value] of Object.entries((item.propertyValues ?? {}) as Record<string, unknown>)) {
          known("fields", id);
          const field = fields.find(field => field.id === id);
          if (field?.projectId && field.projectId !== item.projectId) invalid("field_scope");
          if (value === null) continue;
          if (field?.type === "relation") projectIds.add(known("projects", value));
          if (field?.type === "person") memberIds.add(known("members", value));
          if (field?.type === "select" || field?.type === "multiSelect") for (const option of Array.isArray(value) ? value : [value]) known("options", option);
        }
        try { item.propertyValues = validatePropertyValues(item.propertyValues ?? {}, fields); } catch { invalid("invalid_property_values"); }
        for (const id of projectIds) {
          const row = await tx.get(workspace.collection("projects").doc(id));
          if (!row.exists || row.data()?.archived) invalid("project_unavailable");
        }
        for (const id of memberIds) if (!(await tx.get(workspace.collection("members").doc(id))).exists) invalid("member_unavailable");
      }
      return { proposal: { version: 1, items }, saved: false, requiresHumanReview: true };
    });
  }

  return {
    async execute(name: AgentToolName, input: unknown) {
      if (!(agentToolNames as readonly string[]).includes(name)) invalid("unknown_tool");
      if (Buffer.byteLength(JSON.stringify(input) ?? "", "utf8") > 32_000) invalid();
      const allowed: Record<AgentToolName, string[]> = {
        search_projects: ["name", "memberName", "fieldId"], search_tickets: ["query", "cursor", "projectId"], get_project: ["id"], get_ticket: ["id"],
        summarize_project: ["id", "timeZone"], summarize_tickets: ["ids"], propose_ticket_plan: ["items"],
      };
      const data = object(input, allowed[name]);
      let result: StoreData;
      if (name === "search_projects") result = await catalog(data);
      else if (name === "search_tickets") result = await search(data);
      else if (name === "get_project") result = await getProject(db, workspace, actor, known("projects", data.id));
      else if (name === "get_ticket") result = await ticketDetail(known("tasks", data.id));
      else if (name === "propose_ticket_plan") result = await plan(data);
      else if (name === "summarize_tickets") {
        if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 20 || new Set(data.ids).size !== data.ids.length) invalid();
        const tasks = [];
        for (const id of data.ids) tasks.push(summary(await getTask(db, workspace, actor, known("tasks", id))));
        result = { tasks, observed: counts(tasks), inferredBlockers: [], observationsOnly: true };
      } else {
        const id = known("projects", data.id), project = await getProject(db, workspace, actor, id);
        const page = await search({ query: { version: 1, timeZone: text(data.timeZone, "Timezone", 100), filter: { field: "projectId", op: "eq", value: id }, sort: [{ field: "title", direction: "asc" }] } });
        result = { project, ...page, observed: counts(page.tasks), inferredBlockers: [], observationsOnly: true };
      }
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > outputLimit) invalid("tool_result_limit");
      // Add provenance only for successfully returned selected fields. Strings in
      // descriptions/comments/proposals never grant a record capability.
      const additions: Record<Kind, Set<string>> = { projects: new Set(), tasks: new Set(), members: new Set(), fields: new Set(), options: new Set() };
      const observe = (kind: Kind, id: unknown) => { if (typeof id === "string") additions[kind].add(id); };
      const observeTask = (task: StoreData) => {
        observe("tasks", task.id); observe("projects", task.projectId); observe("members", task.assigneeId);
      };
      if (name === "search_projects") {
        for (const row of result.projects) observe("projects", row.id);
        for (const row of result.members) observe("members", row.id);
        observe("members", result.initiatorId);
        for (const row of result.fields) { observe("fields", row.id); observe("projects", row.projectId); }
        if (result.field) for (const option of result.field.options) observe("options", option.id);
      }
      if (name === "search_tickets" || name === "summarize_project" || name === "summarize_tickets") for (const task of result.tasks) observeTask(task);
      if (name === "get_ticket") observeTask(result);
      for (const kind of Object.keys(additions) as Kind[]) {
        if (new Set([...seen[kind], ...additions[kind]]).size > 512) invalid("provenance_limit");
      }
      for (const kind of Object.keys(additions) as Kind[]) for (const id of additions[kind]) seen[kind].add(id);
      return result;
    },
  };
}
