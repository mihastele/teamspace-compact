"use client";

import { useEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { Project, Task } from "@/lib/model";
import s from "../page.module.css";

type Api = ReturnType<typeof useTeamspace>;
function ProjectEditor({ api, project, close }: { api: Api; project?: Project; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current, prior=document.activeElement as HTMLElement|null;
    element?.showModal(); element?.querySelector<HTMLInputElement>("input")?.focus();
    return ()=>{element?.close();if(prior?.isConnected)prior.focus();};
  },[]);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function attemptClose(){if(!busy && ((name===(project?.name??"") && description===(project?.description??"")) || confirm("Discard unsaved project changes?")))close();}
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="project-editor-title" onCancel={event=>{event.preventDefault();attemptClose();}}><form className={s.dialogBody} onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await api.saveProject(project ? { id: project.id, expectedRevision: project.revision, name, description } : { name, description, operationId });
      close();
    } catch (error) { setError(error instanceof Error ? error.message : "Project could not be saved."); }
    finally { setBusy(false); }
  }}>
    <h2 id="project-editor-title">{project ? "Edit project" : "Create project"}</h2>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy}>
      <label className={s.field}>Project name<input autoFocus required maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label className={s.field}>Description<textarea maxLength={10000} value={description} onChange={event=>setDescription(event.target.value)}/></label>
    </fieldset>
    <button disabled={busy}>{busy ? "Saving…" : "Save project"}</button>{" "}
    <button type="button" disabled={busy} onClick={attemptClose}>Cancel</button>
  </form></dialog>;
}

export default function Projects({ api, onTask, search, initialSelection, onSelect }: { api: Api; onTask: (task: Partial<Task>) => void; search: string; initialSelection: string | null; onSelect: (id:string)=>void }) {
  const [selected, setSelected] = useState<string | null>(initialSelection);
  useEffect(()=>{queueMicrotask(()=>setSelected(initialSelection));},[initialSelection]);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const project = api.projects.find(project=>project.id===selected);
  const tasks = project ? api.tasks.filter(task=>task.projectId===project.id) : [];
  if (creating || (editing && project)) return <ProjectEditor key={creating?"new":project!.id} api={api} project={creating?undefined:project} close={()=>{setCreating(false);setEditing(false);}}/>;
  return <section aria-label="Projects">
    <p className={s.hint}>Everyone in this workspace can access these projects. Archiving preserves linked tasks and prevents new assignments.</p>
    {error && <p role="alert">{error}</p>}
    <button onClick={()=>setCreating(true)}>+ Create project</button>{" "}
    <label><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/> Show archived projects</label>
    <ul>{api.projects.filter(project=>(archived||!project.archived)&&`${project.name} ${project.description}`.toLowerCase().includes(search.toLowerCase())).map(project=><li key={project.id}>
      <button aria-pressed={selected===project.id} onClick={()=>{setSelected(project.id);onSelect(project.id);setError("");}}>{project.name}{project.archived?" (archived)":""}</button>{" · "}{api.tasks.filter(task=>task.projectId===project.id).length} tasks
    </li>)}</ul>
    {project && <article>
      <h2>{project.name}{project.archived?" (archived)":""}</h2>
      <p style={{whiteSpace:"pre-wrap"}}>{project.description}</p>
      <button disabled={busy} onClick={()=>setEditing(true)}>Edit project</button>{" "}
      <button disabled={busy} onClick={async()=>{
        setBusy(true);setError("");
        try { await api.saveProject({id:project.id,expectedRevision:project.revision,archived:!project.archived}); }
        catch(error){setError(error instanceof Error?error.message:"Project could not be updated.");}
        finally{setBusy(false);}
      }}>{project.archived?"Restore project":"Archive project"}</button>{" "}
      <button disabled={project.archived} onClick={()=>onTask({status:"todo",projectId:project.id})}>+ Add task to project</button>
      <h3>Linked tasks ({tasks.length})</h3>
      <ul>{tasks.map(task=><li key={task.id}><button onClick={()=>onTask(task)}>{task.title}</button></li>)}</ul>
      {tasks.length===0&&<p>No linked tasks yet.</p>}
    </article>}
  </section>;
}
