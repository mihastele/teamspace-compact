"use client";

import { useState } from "react";
import type { BoardProperty, Member, Task } from "@/lib/model";
import { sortTableTasks, statusLabels, taskCell, taskColumns, type TableSort } from "@/lib/task-table";
import { deadlineState, matchesDeadline, type DeadlineFilter } from "@/lib/task-deadlines";
import { useLocalDay } from "@/lib/use-local-day";
import s from "./TaskTable.module.css";

export default function TaskTable({ tasks, properties, members, onTask, filtered }: {
  tasks: Task[]; properties: BoardProperty[]; members: Member[];
  onTask: (task: Partial<Task>) => void; filtered: boolean;
}) {
  const today = useLocalDay();
  const [sort, setSort] = useState<TableSort | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [status, setStatus] = useState<"all" | Task["status"]>("all");
  const [deadline, setDeadline] = useState<DeadlineFilter>("all");
  const columns = taskColumns(properties);
  const visible = columns.filter(column => column.id === "title" || !hidden.includes(column.id));
  const activeSort = sort && visible.some(column => column.id === sort.column) ? sort : null;
  const rows = sortTableTasks(tasks.filter(task => (status === "all" || task.status === status) && matchesDeadline(task, deadline, today)), activeSort, properties, members);
  function toggleSort(column: string) {
    setSort(previous => previous?.column !== column ? { column, direction: "ascending" } : previous.direction === "ascending" ? { column, direction: "descending" } : null);
  }
  return <section className={s.tableView} aria-label="Task table">
    <div className={s.controls}>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
        <option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Due date<select value={deadline} onChange={event => setDeadline(event.target.value as DeadlineFilter)}>
        <option value="all">All tasks</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="undated">No due date</option>
      </select></label>
      <details className={s.columnPicker}><summary>Columns ({visible.length})</summary><fieldset><legend>Visible columns</legend>
        {columns.map(column => <label key={column.id}><input type="checkbox" checked={!hidden.includes(column.id)} disabled={column.id === "title"} onChange={event => {
          setHidden(previous => event.target.checked ? previous.filter(id => id !== column.id) : [...previous, column.id]);
          if (!event.target.checked && sort?.column === column.id) setSort(null);
        }} />{column.label}</label>)}
      </fieldset></details>
      {(activeSort || status !== "all" || deadline !== "all" || hidden.length > 0) && <button onClick={() => { setSort(null); setStatus("all"); setDeadline("all"); setHidden([]); }}>Reset table</button>}
    </div>
    <p className={s.hint} role="status">{rows.length} {rows.length === 1 ? "task" : "tasks"}{filtered || status !== "all" || deadline !== "all" ? " matching your filters" : ""} · {activeSort ? `Sorted by ${columns.find(column => column.id === activeSort.column)?.label}, ${activeSort.direction}` : "Board order"}</p>
    <p className={s.hint}>Open a task to edit its fields. Click a column heading to sort ascending, descending, then return to board order. Table settings stay local while this view is open.</p>
    <div className={s.scroll} tabIndex={0} role="region" aria-label="Scrollable task table">
      <table>
        <caption className={s.caption}>Shared workspace tasks and custom fields</caption>
        <thead><tr>{visible.map(column => <th key={column.id} scope="col" aria-sort={activeSort?.column === column.id ? activeSort.direction : "none"}>
          <button onClick={() => toggleSort(column.id)} aria-label={`Sort by ${column.label}`}>
            {column.label}<span aria-hidden="true">{activeSort?.column === column.id ? activeSort.direction === "ascending" ? " ↑" : " ↓" : " ↕"}</span>
          </button>
        </th>)}</tr></thead>
        <tbody>{rows.map(task => <tr key={task.id}>{visible.map(column => {
          const text = taskCell(task, column.id, properties, members);
          const state = column.id === "dueDate" ? deadlineState(task, today) : "none";
          return column.id === "title" ? <th key={column.id} scope="row"><button className={s.task} onClick={() => onTask(task)}>{task.title || "Untitled task"}</button></th> :
            <td key={column.id}><span className={column.id === "status" ? s[task.status] : state === "overdue" ? s.overdue : undefined}>
              {text || (column.id === "assignee" ? "Unassigned" : "—")}{state === "today" && " · Today"}{state === "overdue" && " · Overdue"}
            </span></td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {rows.length === 0 && <p className={s.empty}>{tasks.length > 0 || filtered ? "No tasks match these filters. Reset the table or adjust search and My tasks." : "No tasks yet. Add a task to get started."}</p>}
  </section>;
}
