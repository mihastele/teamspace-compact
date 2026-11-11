"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { BoardView } from "@/lib/model";
import { NamedBoardCreation, newNamedBoard } from "@/lib/named-board";
import { defaultBoardView } from "@/lib/linked-content";
import type { SavedView } from "@/lib/ticket-query";
import TicketFilters from "./TicketFilters";
import s from "./TicketViews.module.css";

export default function NewNamedBoard({ api, initial, disabled, onApply, onCreated, close }: {
  api: ReturnType<typeof useTeamspace>; initial?: BoardView; disabled: boolean;
  onApply: (view: BoardView, baseline: BoardView | undefined) => void;
  onCreated: (view: SavedView) => void; close: () => void;
}) {
  const [baseline] = useState(initial);
  const [draft, setDraft] = useState(newNamedBoard);
  const [creation] = useState(() => new NamedBoardCreation());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const keepEditing = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null), closeOrigin = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), sending = useRef(false), active = useRef(false);
  const latest = useRef({ onApply, onCreated, disabled });
  useLayoutEffect(() => { latest.current = { onApply, onCreated, disabled }; }, [onApply, onCreated, disabled]);
  const heading = useId(), closeHeading = useId();
  const locked = disabled || busy || creation.started || closing;
  useLayoutEffect(() => {
    if (closing) keepEditing.current?.focus();
    else if (closeOrigin.current) {
      (closeOrigin.current.isConnected && !closeOrigin.current.matches(":disabled") ? closeOrigin.current : cancel.current)?.focus();
      closeOrigin.current = null;
    }
  }, [closing]);
  function resumeEditing() {
    setClosing(false);
  }
  function attemptClose() {
    if (sending.current) return;
    if (closing) { resumeEditing(); return; }
    closeOrigin.current = document.activeElement as HTMLElement | null;
    setClosing(true);
  }
  useEffect(() => {
    active.current = true;
    const element = dialog.current, prior = document.activeElement as HTMLElement | null;
    element?.showModal(); element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { active.current = false; element?.close(); if (prior?.isConnected) prior.focus(); };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function create() {
    if (disabled || closing || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const row = await creation.save(draft, api.boardProperties, () => crypto.randomUUID(), api.saveView);
      if (!active.current) return;
      latest.current.onCreated(row);
      if (latest.current.disabled) throw new Error("The board was saved. Wait until the note is editable before linking it.");
      latest.current.onApply({ ...(baseline ?? defaultBoardView), savedViewId: row.id }, baseline);
      close();
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : "Board could not be created. Retry to continue with the same request.");
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return <dialog ref={dialog} className={`${s.dialog} ${s.views}`} aria-labelledby={heading}
    onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); attemptClose();
      }
    }}
    onCancel={event => { event.preventDefault(); attemptClose(); }}>
    <h2 id={heading}>New named board</h2>
    <p className={s.hint}>Choose which shared tickets to show. This creates a reusable board without copying tickets. Existing block filters stay available when you switch back to block settings.</p>
    <fieldset disabled={locked} className={s.group}>
      <div className={s.controls}>
        <label>Board name<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Group by<select value={draft.groupBy} onChange={event => setDraft({ ...draft, groupBy: event.target.value as "status" | "priority" })}><option value="status">Status</option><option value="priority">Priority</option></select></label>
        <label>Date timezone<input maxLength={80} value={draft.query.timeZone} onChange={event => setDraft({ ...draft, query: { ...draft.query, timeZone: event.target.value } })} /></label>
      </div>
      <TicketFilters filter={draft.query.filter} properties={api.boardProperties} projects={api.projects} members={api.members} onChange={filter => setDraft({ ...draft, query: { ...draft.query, filter } })} />
    </fieldset>
    <p className={s.hint}>Filter by Project, status, assignee, dates, priority, estimates or custom properties. Relation properties select linked Projects. Add AND/OR groups to combine conditions.</p>
    {error && <p className={s.error} role="alert">{error}{creation.started && " Retry keeps the original settings and request. If linking fails because the block changed, close this dialog and select the saved board from the picker."}</p>}
    {closing ? <div className={s.group} role="group" aria-labelledby={closeHeading}>
      <h3 id={closeHeading}>{creation.started ? "Close board setup?" : "Discard this board setup?"}</h3>
      <p className={s.hint}>{creation.started ? "A saved board may already exist in Views. Closing keeps it there, even if it is not linked here. You can select it from the board picker." : "Your board name and filters will be discarded. No board has been saved."}</p>
      <div className={s.controls}><button ref={keepEditing} type="button" onClick={resumeEditing}>Keep editing</button><button type="button" onClick={close}>{creation.started ? "Close setup" : "Discard setup"}</button></div>
    </div> : <div className={s.controls}><button ref={cancel} type="button" disabled={busy} onClick={attemptClose}>Cancel</button><button type="button" disabled={disabled || busy || !draft.name.trim()} onClick={() => void create()}>{busy ? "Creating…" : creation.started ? "Retry create and link" : "Create and link board"}</button></div>}
  </dialog>;
}
