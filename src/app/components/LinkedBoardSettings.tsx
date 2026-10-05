"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardView, Member } from "@/lib/model";
import { defaultBoardView, validateBoardView } from "@/lib/linked-content";
import s from "./LinkedContent.module.css";

export default function LinkedBoardSettings({ view, members, disabled, onApply }: {
  view?: BoardView; members: Member[]; disabled: boolean;
  onApply: (next: BoardView, baseline: BoardView | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className={s.viewHeader}>
    <h3>{view?.name || "Workspace board"}</h3>
    <button type="button" disabled={disabled} onClick={() => setOpen(true)}>Edit linked view</button>
    {open && <ViewEditor initial={view} members={members} disabled={disabled} onApply={onApply} close={() => setOpen(false)} />}
  </div>;
}
function ViewEditor({ initial, members, disabled, onApply, close }: {
  initial?: BoardView; members: Member[]; disabled: boolean; close: () => void;
  onApply: (next: BoardView, baseline: BoardView | undefined) => void;
}) {
  const [baseline] = useState(initial);
  const [draft, setDraft] = useState(initial ?? defaultBoardView);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  function attemptClose() {
    if (JSON.stringify(draft) === JSON.stringify(baseline ?? defaultBoardView) || confirm("Discard unsaved view settings?")) close();
  }
  useEffect(() => {
    const element = dialog.current, prior = document.activeElement as HTMLElement | null;
    element?.showModal(); element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (prior?.isConnected) prior.focus(); };
  }, []);
  return <dialog className={s.dialog} ref={dialog} aria-labelledby="linked-view-title" onCancel={event => { event.preventDefault(); attemptClose(); }}>
    <form onSubmit={event => { event.preventDefault(); try { onApply(validateBoardView(draft), baseline); close(); } catch (error) { setError((error as Error).message); } }}>
      <h2 id="linked-view-title">Linked board view</h2>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={disabled}>
        <label>View name<input required maxLength={80} value={draft.name} onChange={event => setDraft({...draft,name:event.target.value})} /></label>
        <label>Search tasks<input maxLength={200} value={draft.query} onChange={event => setDraft({...draft,query:event.target.value})} /></label>
        <label>Status<select value={draft.status} onChange={event => setDraft({...draft,status:event.target.value as BoardView["status"]})}>
          <option value="all">All statuses</option><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option>
        </select></label>
        <label>Assignee<select value={draft.assignee} onChange={event => setDraft({...draft,assignee:event.target.value})}>
          <option value="all">Everyone</option><option value="me">Current viewer</option><option value="unassigned">Unassigned</option>
          {members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          {!["all","me","unassigned",...members.map(member=>member.id)].includes(draft.assignee) && <option value={draft.assignee}>Unavailable member</option>}
        </select></label>
        <label>Due date<select value={draft.deadline} onChange={event => setDraft({...draft,deadline:event.target.value as BoardView["deadline"]})}>
          <option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="undated">No due date</option>
        </select></label>
        <label>Sort cards<select value={draft.sort} onChange={event => setDraft({...draft,sort:event.target.value as BoardView["sort"]})}>
          <option value="position">Board order</option><option value="title">Title</option><option value="dueDate">Due date</option>
        </select></label>
      </fieldset>
      <p>These settings belong to this block. Task edits are shared everywhere. Apply changes, then save the note in local preview; configured saved notes synchronize automatically.</p>
      <div className={s.actions}><button type="button" onClick={attemptClose}>Cancel</button><button disabled={disabled || !draft.name.trim()}>Apply view</button></div>
    </form>
  </dialog>;
}
