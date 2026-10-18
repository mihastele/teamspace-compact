import "server-only";
import type { BoardProperty } from "../model";
import { queryFieldType, type Filter, type TicketQuery } from "../ticket-query";

/** Only static expressions enter SQL. Every ID, search string and cursor is a bound JSON parameter. */
export function compileTicketQuery(query: TicketQuery, fields: readonly BoardProperty[], after?: unknown[]) {
  const parameters: unknown[] = [];
  const bind = (value: unknown, type = "text") => {
    const index = parameters.push(value) - 1;
    return type === "jsonb" ? `($1->${index})` : `(($1->${index})#>>'{}')::${type}`;
  };
  function expression(field: string): { sql: string; type: string } {
    const type = queryFieldType(field, fields);
    const builtins: Record<string, string> = { title: "t.data->>'title'", description: "t.data->>'description'", status: "t.status", priority: "coalesce(t.priority,'none')", assigneeId: "t.assignee_id", projectId: "t.project_id", dueDate: "t.due_date", estimate: "(t.data->>'estimate')::numeric", position: "(t.data->>'position')::numeric" };
    if (Object.hasOwn(builtins, field)) return { sql: builtins[field], type };
    const column = { text: "text_value", longText: "text_value", url: "text_value", number: "number_value", date: "date_value", checkbox: "checkbox_value", select: "option_value::text", person: "person_value", relation: "relation_value", multiSelect: "task_id" }[type]!;
    return { sql: `(select v.${column} from public.teamspace_task_field_values v where v.workspace_id=t.workspace_id and v.task_id=t.id and v.field_id=${bind(field.slice(7), "uuid")} and not v.cleared)`, type };
  }
  function condition(filter: Filter): string {
    if ("and" in filter) return filter.and.length ? `(${filter.and.map(condition).join(" AND ")})` : "true";
    if ("or" in filter) return filter.or.length ? `(${filter.or.map(condition).join(" OR ")})` : "false";
    const resolved = expression(filter.field),type=resolved.type;
    const multi = type === "multiSelect",custom=filter.field.startsWith("custom:")&&!multi;
    const columns:Record<string,string>={text:"text_value",longText:"text_value",url:"text_value",number:"number_value",date:"date_value",checkbox:"checkbox_value",select:"option_value",person:"person_value",relation:"relation_value"};
    const value=custom?`v.${columns[type]}`:resolved.sql;
    const header=custom?`v.workspace_id=t.workspace_id and v.task_id=t.id and v.field_id=${bind(filter.field.slice(7),"uuid")} and not v.cleared`:"";
    const exists=(predicate:string)=>custom?`EXISTS(select 1 from public.teamspace_task_field_values v where ${header} and (${predicate}))`:`(${predicate})`;
    const empty = multi ? `NOT EXISTS(select 1 from public.teamspace_task_field_selections s where s.workspace_id=t.workspace_id and s.task_id=t.id and s.field_id=${bind(filter.field.slice(7), "uuid")})` : ["text", "longText", "url"].includes(type) ? `(${value} IS NULL OR ${value}='')` : `${value} IS NULL`;
    if (filter.op === "isEmpty") return custom?`NOT (${exists(`NOT (${empty})`)})`:`(${empty})`;
    if (filter.op === "isNotEmpty") return custom?exists(`NOT (${empty})`):`(NOT (${empty}))`;
    if (multi) {
      const selected = bind(filter.value, "jsonb"), field = bind(filter.field.slice(7), "uuid");
      const found = `select s.option_id::text from public.teamspace_task_field_selections s where s.workspace_id=t.workspace_id and s.task_id=t.id and s.field_id=${field}`;
      return filter.op === "containsAny" ? `EXISTS(${found} and s.option_id::text in (select jsonb_array_elements_text(${selected})))` : `NOT EXISTS(select 1 from jsonb_array_elements_text(${selected}) desired where desired not in (${found}))`;
    }
    const cast = custom && type === "select" ? "uuid" : type === "number" ? "numeric" : type === "checkbox" ? "boolean" : type === "date" && filter.field.startsWith("custom:") ? "date" : "text";
    const comparable = ["text", "longText", "url"].includes(type) ? `lower(${value})` : value;
    const parameter = (input: unknown) => ["text", "longText", "url"].includes(type) ? `lower(${bind(input)})` : bind(input, cast);
    let predicate: string;
    if (["in", "notIn"].includes(filter.op)) predicate = `${comparable} IN (${(filter.value as unknown[]).map(parameter).join(",")})`;
    else if (["contains", "notContains"].includes(filter.op)) predicate = `strpos(lower(${value}),lower(${bind(filter.value)}))>0`;
    else if (filter.op === "between") { const [start, end] = filter.value as unknown[]; predicate = `${value} BETWEEN ${parameter(start)} AND ${parameter(end)}`; }
    else predicate = `${comparable} ${{ eq: "=", neq: "=", before: "<", after: ">", gt: ">", lt: "<" }[filter.op]} ${parameter(filter.value)}`;
    return ["neq", "notIn", "notContains"].includes(filter.op) ? (custom?`(NOT (${exists(predicate)}))`:`(NOT coalesce((${predicate}),false))`) : exists(predicate);
  }
  const where = condition(query.filter);
  const keys = (query.sort.length ? query.sort : [{ field: "position", direction: "asc" as const }]).map(sort => {
    const { sql, type } = expression(sort.field);
    let key = sql, cast = type === "number" ? "numeric" : type === "checkbox" ? "boolean" : type === "date" && sort.field.startsWith("custom:") ? "date" : "text";
    if (sort.field === "status") { key = `case ${sql} when 'todo' then 0 when 'doing' then 1 when 'done' then 2 end`; cast = "numeric"; }
    else if (sort.field === "priority") { key = `case ${sql} when 'none' then 0 when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'urgent' then 4 end`; cast = "numeric"; }
    else if (type === "select") key = `(select lower(o.label) from public.teamspace_field_options o where o.workspace_id=t.workspace_id and o.field_id=${bind(sort.field.slice(7), "uuid")} and o.id::text=${sql})`;
    else if (type === "person") key = `(select lower(m.data->>'displayName') from public.teamspace_documents m where m.path='workspaces/'||t.workspace_id||'/members/'||${sql})`;
    else if (type === "relation") key = `(select lower(p.name) from public.teamspace_projects p where p.workspace_id=t.workspace_id and p.id=${sql})`;
    else if (["text", "longText", "url"].includes(type)) key = `nullif(lower(${sql}),'')`;
    if (cast === "text") key = `(${key}) COLLATE "C"`;
    return { sql: key, cast, direction: sort.direction };
  });
  keys.push({ sql: 't.id COLLATE "C"', cast: "text", direction: "asc" });
  if (after && after.length !== keys.length) throw new Error("Cursor does not match query sorts.");
  let page = "true";
  if (after) {
    const equals: string[] = [], terms: string[] = [];
    keys.forEach((key, index) => {
      const value = after[index];
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error("Invalid cursor key.");
      if (value !== null && ((key.cast === "numeric" && (typeof value !== "number" || !Number.isFinite(value))) || (key.cast === "boolean" && typeof value !== "boolean") || (["text", "date"].includes(key.cast) && typeof value !== "string"))) throw new Error("Invalid cursor key type.");
      const param = value === null ? null : bind(value, key.cast);
      const greater = param ? `(${key.sql} IS NULL OR ${key.sql}${key.direction === "asc" ? ">" : "<"}${param})` : "false";
      terms.push(`(${[...equals, greater].join(" AND ")})`);
      equals.push(param ? `${key.sql} IS NOT DISTINCT FROM ${param}` : `${key.sql} IS NULL`);
    });
    page = `(${terms.join(" OR ")})`;
  }
  return { where: `(${where}) AND (${page})`, order: keys.map(key => `${key.sql} ${key.direction} NULLS LAST`).join(","), keys: `jsonb_build_array(${keys.map(key => key.sql).join(",")})`, parameters };
}
