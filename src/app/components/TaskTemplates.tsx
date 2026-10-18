"use client";

import { useEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { Task, TaskTemplate } from "@/lib/model";
import { applyTaskTemplate, taskBlockTypes, templateDefaults } from "@/lib/task-pages";
import { validatePropertyValues } from "@/lib/board-properties";
import BlockEditor from "./BlockEditor";
import { TaskPropertyInputs } from "./BoardProperties";
import s from "../page.module.css";

type Api = ReturnType<typeof useTeamspace>;
function TemplateEditor({ api, initial, close }: { api: Api; initial: TaskTemplate; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || composing) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, composing]);
  function attemptClose() { if (!busy && (!dirty || confirm("Discard unsaved template changes?"))) close(); }
  useEffect(() => {
    const element = dialog.current, prior = document.activeElement as HTMLElement | null;
    element?.showModal(); element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (prior?.isConnected) prior.focus(); };
  }, []);
  const defaults = draft.defaults;
  return <dialog ref={dialog} className={`${s.dialog} ${s.taskPage}`} aria-labelledby="template-title" onCancel={event => { event.preventDefault(); attemptClose(); }}>
    <div className={s.dialogHeader}><h2 id="template-title">{initial.revision ? "Edit task template" : "Save as task template"}</h2><button type="button" onClick={attemptClose} disabled={busy} aria-label="Close template editor">×</button></div>
    <div className={s.dialogBody}>
      <p className={s.hint}>Shared with this workspace. New tasks receive an independent copy of these blocks and defaults. Attachments and conversations are not copied.</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label className={s.field}>Template name<input maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className={s.field}>Default task title<input maxLength={200} value={defaults.title} onChange={event => setDraft({ ...draft, defaults: { ...defaults, title: event.target.value } })} /></label>
        <label className={s.field}>Default status<select value={defaults.status} onChange={event => setDraft({ ...draft, defaults: { ...defaults, status: event.target.value as Task["status"] } })}><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select></label>
        <label className={s.field}>Default assignee<select value={defaults.assigneeId ?? ""} onChange={event => setDraft({ ...draft, defaults: { ...defaults, assigneeId: event.target.value || null } })}><option value="">Unassigned</option>{api.members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
        <label className={s.field}>Default due date<input type="date" value={defaults.dueDate ?? ""} onChange={event => setDraft({ ...draft, defaults: { ...defaults, dueDate: event.target.value || null } })} /></label>
        {api.projectsEnabled && <>
          <label className={s.field}>Default project<select value={defaults.projectId ?? ""} onChange={event => setDraft({ ...draft, defaults: { ...defaults, projectId: event.target.value || null } })}><option value="">No project</option>{api.projects.map(project => <option key={project.id} value={project.id} disabled={project.archived}>{project.name}{project.archived ? " (archived)" : ""}</option>)}</select></label>
          <label className={s.field}>Default priority<select value={defaults.priority ?? "none"} onChange={event => setDraft({ ...draft, defaults: { ...defaults, priority: event.target.value as Task["priority"] } })}>{["none", "low", "medium", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label>
          <label className={s.field}>Default estimate<input type="number" min="0" max="1000000" step="any" value={defaults.estimate ?? ""} onChange={event => setDraft({ ...draft, defaults: { ...defaults, estimate: event.target.value === "" ? null : event.target.valueAsNumber } })} /></label>
        </>}
        <TaskPropertyInputs properties={api.boardProperties} values={defaults.propertyValues ?? {}} disabled={busy} members={api.members} projects={api.projects} projectId={defaults.projectId} onChange={(id, value) => setDraft({ ...draft, defaults: { ...defaults, propertyValues: { ...defaults.propertyValues, [id]: value } } })} />
        {Object.keys(defaults.propertyValues ?? {}).some(id => !api.boardProperties.some(field => field.id === id && (!field.projectId || field.projectId === defaults.projectId))) && <button type="button" onClick={() => setDraft({ ...draft, defaults: { ...defaults, propertyValues: Object.fromEntries(Object.entries(defaults.propertyValues ?? {}).filter(([id]) => api.boardProperties.some(field => field.id === id && (!field.projectId || field.projectId === defaults.projectId)))) } })}>Remove unavailable custom defaults</button>}
      </fieldset>
      <h3>Template body</h3>
      <BlockEditor allowedBlockTypes={taskBlockTypes} value={defaults.content} disabled={busy} onCompositionPendingChange={setComposing} onChange={content => setDraft(previous => ({ ...previous, defaults: { ...previous.defaults, content } }))} />
    </div>
    <div className={s.dialogActions}>
      <button type="button" disabled={busy} onClick={attemptClose}>Cancel</button>
      <button type="button" className={s.primary} disabled={busy || composing || !draft.name.trim() || !defaults.title.trim()} onClick={async () => {
        setBusy(true); setError("");
        try { await api.saveTaskTemplate({ id: draft.id, name: draft.name, defaults: templateDefaults(defaults), expectedRevision: initial.revision, archived: draft.archived }); close(); }
        catch (error) { setError(error instanceof Error ? error.message : "Template could not be saved."); }
        finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save template"}</button>
    </div>
  </dialog>;
}

export default function TaskTemplates({ api, current, disabled, canApply, onApply }: { api: Api; current: TaskTemplate["defaults"]; disabled: boolean; canApply: boolean; onApply: (defaults: TaskTemplate["defaults"]) => void }) {
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<TaskTemplate | null>(null);
  return <details className={s.taskTemplates}><summary>Templates</summary>
    <p className={s.hint}>Create a template from this task, or edit a shared template. Apply templates when creating a new task.</p>
    {error && <p role="alert">{error}</p>}
    {applying && <div role="group" aria-label="Apply task template"><p>Replace this new task’s title, properties and body with {applying.name}?</p><button type="button" disabled={disabled || busy} onClick={() => {
      try {
        const defaults = applyTaskTemplate(applying);
        validatePropertyValues(defaults.propertyValues ?? {}, api.boardProperties);
        if (defaults.assigneeId && !api.members.some(member => member.id === defaults.assigneeId)) throw new Error("The template assignee is unavailable. Edit the template first.");
        if (defaults.projectId && !api.projects.some(project => project.id === defaults.projectId && !project.archived)) throw new Error("The template project is unavailable. Edit the template first.");
        for (const [id, value] of Object.entries(defaults.propertyValues ?? {})) {
          if (value === null) continue;
          const field = api.boardProperties.find(field => field.id === id)!;
          if (field.projectId && field.projectId !== defaults.projectId) throw new Error("A template field belongs to another project. Edit the template first.");
          if (field.type === "person" && !api.members.some(member => member.id === value)) throw new Error("A template person is unavailable. Edit the template first.");
          if (field.type === "relation" && !api.projects.some(project => project.id === value && !project.archived)) throw new Error("A template relation is unavailable. Edit the template first.");
        }
        onApply(defaults); setApplying(null); setError("");
      } catch (error) { setError(error instanceof Error ? error.message : "Template defaults need review before use."); }
    }}>Replace new task with template</button><button type="button" onClick={() => setApplying(null)}>Cancel template application</button></div>}
    <button type="button" disabled={disabled || busy || !current.title.trim()} onClick={() => setEditing({ id: crypto.randomUUID(), name: "", revision: 0, defaults: templateDefaults(current) })}>Save current task as template</button>
    {api.taskTemplates.map(template => <div className={s.templateRow} key={template.id}>
      <strong>{template.name}{template.archived ? " (archived)" : ""}</strong>
      {canApply && !template.archived && <button type="button" disabled={disabled || busy} onClick={() => setApplying(template)}>Use template</button>}
      <button type="button" disabled={disabled || busy} onClick={() => setEditing(template)}>Edit template</button>
      <button type="button" disabled={disabled || busy} onClick={async () => {
        setBusy(true); setError("");
        try { await api.saveTaskTemplate({ id: template.id, name: template.name, defaults: template.defaults, expectedRevision: template.revision, archived: !template.archived }); }
        catch (error) { setError(error instanceof Error ? error.message : "Template could not be updated."); }
        finally { setBusy(false); }
      }}>{template.archived ? "Restore template" : "Archive template"}</button>
    </div>)}
    {editing && <TemplateEditor key={editing.id} api={api} initial={editing} close={() => setEditing(null)} />}
  </details>;
}
