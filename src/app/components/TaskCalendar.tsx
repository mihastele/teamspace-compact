"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Member, Task } from "@/lib/model";
import { calendarAgenda, calendarDays, calendarLabel, calendarLastDay, calendarTasks, shiftDay, shiftMonth } from "@/lib/task-calendar";
import { useLocalDay } from "@/lib/use-local-day";
import s from "./TaskCalendar.module.css";

const statusLabels = { todo: "To do", doing: "In progress", done: "Done" };

export default function TaskCalendar({ tasks, members, onTask, filtered }: {
  tasks: Task[]; members: Member[]; onTask: (task: Partial<Task>) => void; filtered: boolean;
}) {
  const today = useLocalDay();
  const [chosen, setChosen] = useState("");
  const [mode, setMode] = useState<"month" | "agenda">("month");
  const [includeDone, setIncludeDone] = useState(false);
  const selected = chosen || today;
  const month = selected.slice(0, 7);
  const days = useMemo(() => month ? calendarDays(month) : [], [month]);
  const { dated, undated } = useMemo(() => calendarTasks(tasks, includeDone), [tasks, includeDone]);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusDate = useRef(false);
  useEffect(() => {
    if (focusDate.current && mode === "month") {
      dayButtons.current.get(selected)?.focus();
      focusDate.current = false;
    }
  }, [selected, mode]);

  function navigate(amount: number) {
    try { setChosen(shiftMonth(selected, amount)); } catch { /* Four-digit calendar limit. */ }
  }
  function taskRow(task: Task) {
    const assignee = members.find((member) => member.id === task.assigneeId);
    return <button key={task.id} className={s.task} onClick={() => onTask(task)}>
      <span className={`${s.status} ${s[task.status]}`} aria-hidden="true" />
      <span className={s.taskText}><strong>{task.title}</strong><small>{statusLabels[task.status]} · {assignee?.displayName || "Unassigned"}</small></span>
      <span aria-hidden="true">↗</span>
    </button>;
  }

  if (!today) return <p role="status">Opening your calendar…</p>;
  const dayTasks = dated.get(selected) || [];
  const count = [...dated.values()].reduce((total, list) => total + list.length, 0) + undated.length;
  const { scheduled: agenda, overdue } = calendarAgenda(dated, month, today);
  let canPrevious = true, canNext = true;
  try { shiftMonth(selected, -1); } catch { canPrevious = false; }
  try { shiftMonth(selected, 1); } catch { canNext = false; }

  return <section className={s.calendar} aria-label="Task calendar">
    <div className={s.controls}>
      <div className={s.navigation}>
        <button aria-label="Previous month" disabled={!canPrevious} onClick={() => navigate(-1)}>‹</button>
        <h2 aria-live="polite">{calendarLabel(`${month}-01`, true)}</h2>
        <button aria-label="Next month" disabled={!canNext} onClick={() => navigate(1)}>›</button>
        <button onClick={() => setChosen(today)}>Today</button>
      </div>
      <div className={s.options}>
        <label><input type="checkbox" checked={includeDone} onChange={(event) => setIncludeDone(event.target.checked)} /> Show completed</label>
        <div className={s.segment} aria-label="Calendar display">
          <button aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
          <button aria-pressed={mode === "agenda"} onClick={() => setMode("agenda")}>Agenda</button>
        </div>
      </div>
    </div>
    <p className={s.hint}>{count} {includeDone ? "tasks" : "open tasks"}{filtered ? " matching your filters" : ""} · Deadlines follow your local calendar day.</p>
    {mode === "month" ? <div className={s.layout}>
      <div>
        <div className={s.weekdays} aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className={s.grid} role="group" aria-label="Choose a day; arrow keys move by day or week, Page Up and Page Down change month">
          {days.map(({ day, inMonth }, index) => {
            if (!day) return <div key={`blank-${index}`} />;
            const list = dated.get(day) || [];
            return <button key={day} ref={(element) => { if (element) dayButtons.current.set(day, element); else dayButtons.current.delete(day); }}
              className={`${s.day} ${!inMonth ? s.outside : ""} ${day === today ? s.today : ""} ${day === selected ? s.selected : ""}`}
              tabIndex={day === selected ? 0 : -1} aria-pressed={day === selected} aria-current={day === today ? "date" : undefined}
              aria-label={`${calendarLabel(day)}: ${list.length} ${list.length === 1 ? "task" : "tasks"}`}
              onClick={() => { focusDate.current = day !== selected; setChosen(day); }} onKeyDown={(event) => {
                const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                const offset = offsets[event.key];
                if (offset !== undefined || event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  try {
                    const next = offset !== undefined ? shiftDay(day, offset) : event.key === "Home" ? `${month}-01` : event.key === "End" ? calendarLastDay(month) : shiftMonth(day, event.key === "PageUp" ? -1 : 1);
                    focusDate.current = true;
                    setChosen(next);
                    if (next === selected) focusDate.current = false;
                  } catch { focusDate.current = false; }
                }
              }}>
              <span className={s.dayNumber}>{Number(day.slice(-2))}</span>
              <span className={s.previews} aria-hidden="true">{list.slice(0, 2).map((task) => <span key={task.id} className={task.status === "done" ? s.completed : ""}>{task.title}</span>)}{list.length > 2 && <small>+{list.length - 2} more</small>}</span>
              <span className={s.mobileCount} aria-hidden="true">{list.length || ""}</span>
            </button>;
          })}
        </div>
        <p className={s.hint}>Select a day to see its tasks. Use arrow keys to explore.</p>
      </div>
      <aside className={s.details} aria-label="Selected day">
        <h3>{calendarLabel(selected)}</h3>
        {selected < today && dayTasks.some((task) => task.status !== "done") && <p className={s.overdue}>Unfinished deadlines</p>}
        {dayTasks.length ? dayTasks.map(taskRow) : <p className={s.empty}>Nothing scheduled{filtered ? " matching your filters" : ""}. A little breathing room.</p>}
        <button className={s.add} onClick={() => onTask({ status: "todo", dueDate: selected })}>+ Add task for this day</button>
      </aside>
    </div> : <div className={s.agenda}>
      {overdue.length > 0 && <section aria-label="Overdue tasks"><h3 className={s.overdue}>Overdue</h3>{overdue.map(([day, list]) => {
        const open = list.filter((task) => task.status !== "done");
        return open.length ? <div key={day}><h4>{calendarLabel(day)}</h4>{open.map(taskRow)}</div> : null;
      })}</section>}
      <section aria-label="Scheduled tasks"><h3>Scheduled from {calendarLabel(`${month}-01`)}</h3>
        {agenda.length ? agenda.map(([day, list]) => <div key={day}><h4>{calendarLabel(day)}</h4>{list.map(taskRow)}</div>) : <p className={s.empty}>No upcoming tasks{filtered ? " matching your filters" : ""}.</p>}
      </section>
    </div>}
    <section className={s.undated} aria-label="Tasks without a due date"><h3>No due date <span>({undated.length})</span></h3>
      <p className={s.hint}>Open a task to give it a deadline.</p>
      {undated.length ? <div className={s.undatedList}>{undated.map(taskRow)}</div> : <p className={s.empty}>All visible tasks have a date.</p>}
    </section>
  </section>;
}
