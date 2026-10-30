"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardProperty, PropertyValue, Task, Member, Project } from "@/lib/model";
import type { useTeamspace } from "@/lib/client";
import { MAX_PROPERTIES, propertyDisplay, optionColors } from "@/lib/board-properties";
import s from "./BoardProperties.module.css";

type Api = ReturnType<typeof useTeamspace>;
const colors:Record<string,string> = {gray:"#687587",red:"#ba3447",orange:"#ac5a19",yellow:"#87700a",green:"#24734e",blue:"#2d63b6",purple:"#7c49ac",pink:"#ad4081"};
const labels = { text:"Text", longText:"Long text", number:"Number", date:"Date", checkbox:"Checkbox", select:"Select", multiSelect:"Multi-select", person:"Person", relation:"Project relation", url:"URL", email:"Email", phone:"Phone", status:"Status" };

function PropertyEditor({ api, initial, close }: { api: Api; initial?: BoardProperty; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<BoardProperty["type"]>(initial?.type ?? "text");
  const [options, setOptions] = useState(initial?.options ?? []);
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (prior?.isConnected) prior.focus(); };
  }, []);
  const changed = projectId !== (initial?.projectId ?? "") || name !== (initial?.name ?? "") || type !== (initial?.type ?? "text") || JSON.stringify(options) !== JSON.stringify(initial?.options ?? []);
  function attemptClose() {
    if (!busy && (!changed || confirm("Discard unsaved property changes?"))) close();
  }
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={`property-title-${id}`}
    onCancel={event => { event.preventDefault(); attemptClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError("");
      try { await api.saveBoardProperty({ id, name, type, options, ...(api.projectsEnabled ? {projectId:projectId||null} : {}) }, initial?.revision ?? 0); close(); }
      catch (error) { setError(error instanceof Error ? error.message : "Property could not be saved."); }
      finally { setBusy(false); }
    }}>
      <h2 id={`property-title-${id}`}>{initial ? "Edit property" : "Add property"}</h2>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label>Name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Priority, Release date" /></label>
        <label>Type<select value={type} disabled={Boolean(initial)} onChange={event => { setType(event.target.value as BoardProperty["type"]); setOptions([]); }}>
          {Object.entries(labels).filter(([value])=>api.projectsEnabled || ["text","select","multiSelect","date"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {api.projectsEnabled && <label>Scope<select value={projectId} disabled={Boolean(initial)} onChange={event=>setProjectId(event.target.value)}><option value="">Workspace</option>{api.projects.filter(project=>!project.archived||project.id===projectId).map(project=><option key={project.id} value={project.id}>{project.name}{project.archived?" (archived)":""}</option>)}</select></label>}
        {(type === "select" || type === "multiSelect") && <div>
          <h3>Options</h3>
          {options.map((option,index)=><div key={option.id}>
            <label>Option {index+1}<input required maxLength={80} value={option.name} onChange={event=>setOptions(previous=>previous.map(item=>item.id===option.id?{...item,name:event.target.value}:item))}/></label>
            {api.projectsEnabled && <>
              <label>Color<select value={option.color??"gray"} onChange={event=>setOptions(previous=>previous.map(item=>item.id===option.id?{...item,color:event.target.value}:item))}>{optionColors.map(color=><option key={color} value={color}>{color}</option>)}</select></label>
              <label><input type="checkbox" checked={option.archived===true} onChange={event=>setOptions(previous=>previous.map(item=>item.id===option.id?{...item,archived:event.target.checked}:item))}/>Archived</label>
              <button type="button" disabled={index===0} onClick={()=>setOptions(previous=>{const next=[...previous];[next[index-1],next[index]]=[next[index],next[index-1]];return next;})}>Move up</button>
              <button type="button" disabled={index===options.length-1} onClick={()=>setOptions(previous=>{const next=[...previous];[next[index],next[index+1]]=[next[index+1],next[index]];return next;})}>Move down</button>
            </>}
          </div>)}
          <button type="button" disabled={options.length >= 50} onClick={() => setOptions(previous => [...previous, { id: crypto.randomUUID(), name: "" }])}>Add option</button>
        </div>}
      </fieldset>
      <p className={s.hint}>Changes apply to every task using this property.</p>
      <div className={s.actions}><button type="button" disabled={busy} onClick={attemptClose}>Cancel</button><button disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save property"}</button></div>
    </form>
  </dialog>;
}

export function BoardProperties({ api, columns, hidden = [], onVisibilityChange, align = "start" }: { api: Api; columns?: { id: string; label: string }[]; hidden?: string[]; onVisibilityChange?: (id: string, visible: boolean) => void; align?: "start" | "end" }) {
  const [editing, setEditing] = useState<BoardProperty | "new" | null>(null);
  const [exportError, setExportError] = useState("");
  return <div className={`${s.manager} ${align === "end" ? s.alignEnd : ""}`}>
    <details onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); const details = event.currentTarget; details.open = false; details.querySelector("summary")?.focus(); } }}><summary>Properties</summary>
      <div className={s.list}>
        {columns ? columns.map(column => {
          const property = api.boardProperties.find(field => column.id === `property:${field.id}`);
          return <div className={s.propertyRow} key={column.id}>
            <label><input type="checkbox" checked={!hidden.includes(column.id)} disabled={column.id === "title"} onChange={event => onVisibilityChange?.(column.id, event.target.checked)} />{column.label}</label>
            {property && <button type="button" aria-label={`Edit ${property.name}`} onClick={() => setEditing(property)}>Edit</button>}
          </div>;
        }) : api.boardProperties.map(property => <button type="button" className={s.definition} key={property.id} onClick={() => setEditing(property)}><span>{property.name}</span><small>{labels[property.type]}{property.projectId ? ` · ${api.projects.find(project=>project.id===property.projectId)?.name??"Project"}` : ""}</small></button>)}
        {api.boardProperties.length === 0 && !columns && <p className={s.hint}>Add the details your team needs.</p>}
        <button type="button" disabled={api.boardProperties.length >= MAX_PROPERTIES} onClick={() => setEditing("new")}>+ Add property</button>
        <details className={s.export}><summary>Export data</summary><button type="button" onClick={() => {
          setExportError("");
          let url: string | undefined;
          try {
            url = URL.createObjectURL(new Blob([JSON.stringify({ version: 4, templates: api.taskTemplates, views: api.savedViews, projects: api.projects, properties: api.boardProperties, tasks: api.tasks }, null, 2)], { type: "application/json" }));
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = "teamspace-board.json"; document.body.append(anchor); anchor.click(); anchor.remove();
            const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
          } catch { if (url) URL.revokeObjectURL(url); setExportError("Board export failed. Your data is unchanged."); }
        }}>Download board JSON</button>
        <p className={s.hint}>Exports all saved views, projects, task templates, tasks (including full block bodies) and field definitions. Attachments and conversations are separate.</p>
        {exportError && <p role="alert">{exportError}</p>}
        </details>
      </div>
    </details>
    {editing && <PropertyEditor key={editing === "new" ? "new" : editing.id} api={api} initial={editing === "new" ? undefined : editing} close={() => setEditing(null)} />}
  </div>;
}

export function TaskPropertyInputs({properties,values,onChange,disabled,members=[],projects=[],projectId,api}: {
  properties:BoardProperty[];values:Record<string,PropertyValue>;onChange:(id:string,value:PropertyValue)=>void;disabled:boolean;members?:Member[];projects?:Project[];projectId?:string|null;api?:Api;
}) {
  const [editing, setEditing] = useState<BoardProperty | "new" | null>(null);
  const available=properties.filter(property=>!property.projectId||property.projectId===projectId);
  const name = (property: BoardProperty) => api ? <button type="button" className={s.propertyName} aria-label={`Edit ${property.name} property`} onClick={() => setEditing(property)}>{property.name}<span aria-hidden="true"> ···</span></button> : property.name;
  return <fieldset className={s.values} disabled={disabled}>
    {available.map(property=>{
      const value=values[property.id];
      if(property.type==="multiSelect")return <fieldset key={property.id} className={s.options}><legend>{name(property)}</legend>
        {property.options.length===0&&<p className={s.hint}>No options yet.{api && <button type="button" onClick={() => setEditing(property)}>Add options</button>}</p>}
        {property.options.map(option=><label key={option.id}><input type="checkbox" disabled={option.archived&&!(Array.isArray(value)&&value.includes(option.id))} checked={Array.isArray(value)&&value.includes(option.id)} onChange={event=>{
          const selected=Array.isArray(value)?value:[];onChange(property.id,event.target.checked?[...selected,option.id]:selected.filter(id=>id!==option.id));
        }}/>{option.name}{option.archived?" (archived)":""}</label>)}</fieldset>;
      if(property.type==="checkbox")return <div className={s.checkboxRow} key={property.id}>{api && name(property)}<label><input type="checkbox" checked={value===true} onChange={event=>onChange(property.id,event.target.checked)}/>{api ? <span className={s.srOnly}>{property.name}</span> : property.name}</label>{value==null?<span>Unset</span>:<button type="button" onClick={()=>onChange(property.id,null)}>Clear</button>}</div>;
      return <div className={s.valueRow} key={property.id}><label><span className={api ? s.srOnly : undefined}>{property.name}</span>
        {property.type==="select"?<select value={typeof value==="string"?value:""} onChange={event=>onChange(property.id,event.target.value||null)}><option value="">No selection</option>{property.options.map(option=><option key={option.id} value={option.id} disabled={option.archived&&value!==option.id}>{option.name}{option.archived?" (archived)":""}</option>)}</select>:
          property.type==="person"||property.type==="relation"?<select value={typeof value==="string"?value:""} onChange={event=>onChange(property.id,event.target.value||null)}><option value="">No selection</option>
            {property.type==="person"?<>
              {typeof value==="string"&&!members.some(member=>member.id===value)&&<option value={value}>Unavailable member</option>}
              {members.map(member=><option key={member.id} value={member.id}>{member.displayName}</option>)}
            </>:<>
              {typeof value==="string"&&!projects.some(project=>project.id===value)&&<option value={value}>Unavailable project</option>}
              {projects.map(project=><option key={project.id} value={project.id} disabled={project.archived&&value!==project.id}>{project.name}{project.archived?" (archived)":""}</option>)}
            </>}
          </select>:property.type==="longText"?<textarea maxLength={10000} value={typeof value==="string"?value:""} onChange={event=>onChange(property.id,event.target.value||null)}/>:
            <input type={property.type==="date"?"date":property.type==="number"?"number":property.type==="url"?"url":"text"} step={property.type==="number"?"any":undefined} maxLength={2000} value={typeof value==="string"||(typeof value==="number"&&Number.isFinite(value))?value:""} onChange={event=>onChange(property.id,event.target.value===""?null:property.type==="number"?event.target.valueAsNumber:event.target.value)}/>}
      </label>{api && name(property)}</div>;
    })}
    {api && <button type="button" className={s.addProperty} disabled={properties.length >= MAX_PROPERTIES} onClick={() => setEditing("new")}>+ Add property</button>}
    {api && editing && <PropertyEditor key={editing === "new" ? "new" : editing.id} api={api} initial={editing === "new" ? undefined : editing} close={() => setEditing(null)} />}
  </fieldset>;
}

export function TaskPropertySummary({task,properties,members=[],projects=[]}:{task:Task;properties:BoardProperty[];members?:Member[];projects?:Project[]}) {
  const values=properties.map(property=>({property,text:propertyDisplay(property,task.propertyValues?.[property.id],members,projects)})).filter(item=>item.text);
  return values.length?<span className={s.summary}>{values.map(({property,text})=><span key={property.id}><strong>{property.name}:</strong>{" "}
    {["select","multiSelect"].includes(property.type) ? property.options.filter(option=>{
      const selected=task.propertyValues?.[property.id];return Array.isArray(selected)?selected.includes(option.id):selected===option.id;
    }).map(option=><span key={option.id} style={{borderLeft:`3px solid ${colors[option.color??"gray"]??colors.gray}`,paddingLeft:4}}>{option.name}{option.archived?" (archived)":""}</span>) : text}
  </span>)}</span>:null;
}
