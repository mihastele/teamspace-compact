"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { DatabaseDefinition, DatabaseEntry, DatabaseField, IncomingRelation } from "@/lib/databases";
import { databasePropertyTypes, statusGroups } from "@/lib/databases";
import { createdTimeDisplay, databaseFieldInput, databaseFields, databaseValues } from "@/lib/databases";
import { databaseColumns, sortDatabaseEntries } from "@/lib/database-table";
import type { TableSort } from "@/lib/task-table";
import { propertyDisplay } from "@/lib/board-properties";
import { taskBlockTypes } from "@/lib/task-pages";
import { noteContent } from "@/lib/server/validation";
import { useTaskDraftLock } from "@/lib/use-task-draft-lock";
import type { NoteContent, PropertyValue, Task } from "@/lib/model";
import BlockEditor from "./BlockEditor";
import DatabaseRelationPicker from "./DatabaseRelationPicker";
import s from "./Databases.module.css";
type Api = ReturnType<typeof useTeamspace>;
const labels = { text:"Text", longText:"Long text", number:"Number", date:"Date", checkbox:"Checkbox", select:"Select", multiSelect:"Multi-select", person:"Person", relation:"Relation", url:"URL", email:"Email", phone:"Phone", status:"Status", createdTime:"Created time" };
type Form = { name:string; description:string; fields:DatabaseField[]; title:string; content:NoteContent; propertyValues:Record<string,PropertyValue>; archived:boolean };
type Packet = { id:string; kind:"databases"|"databaseEntries"; expectedRevision:number; form:Form; operationId:string|null; databaseId:string };
function download(name:string, data:unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const link=document.createElement("a"); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function relationChoices(request:Api["databaseRequest"],id:string) {
  const entries:DatabaseEntry[]=[];
  let cursor:string|null=null;
  do {
    const result=await request(`databases/${id}?summary=1${cursor?`&cursor=${cursor}`:""}`,"GET");
    entries.push(...result.entries);
    if(result.nextCursor===cursor&&cursor)throw new Error("Could not advance relation choices.");
    cursor=result.nextCursor;
  }while(cursor&&entries.length<1000);
  return entries;
}

function Editor({ api, database, entry, definitions, close, saved, openEntry }: { api:Api; database:DatabaseDefinition; entry?:DatabaseEntry; definitions:DatabaseDefinition[]; close:()=>void; saved:(databaseId:string)=>void; openEntry:(id:string)=>void }) {
  const request=api.databaseRequest;
  const dialog=useRef<HTMLDialogElement>(null);
  const kind=entry?"databaseEntries":"databases";
  const record=entry??database;
  const key=`teamspace:database-draft:v1:${api.user!.uid}:${api.workspace!.id}:${kind}:${record.revision?record.id:entry?`new:${database.id}`:"new"}`;
  const initial:Packet={id:record.id,kind,expectedRevision:record.revision,operationId:null,databaseId:database.id,form:{name:database.name,description:database.description,fields:database.fields,title:entry?.title??"",content:entry?.content??{blocks:[{type:"paragraph",text:""}]},propertyValues:entry?.propertyValues??{},archived:record.archived}};
  const [draft,setDraft]=useState(initial);
  const [error,setError]=useState("");
  const [storageError,setStorageError]=useState(false);
  const [unreadable,setUnreadable]=useState(false);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [composition,setComposition]=useState(false);
  const [targets,setTargets]=useState<Record<string,DatabaseEntry[]>>({});
  const [relationError,setRelationError]=useState("");
  const [relationRefresh,setRelationRefresh]=useState(0);
  const [incoming,setIncoming]=useState<IncomingRelation[]>([]);
  const [incomingTruncated,setIncomingTruncated]=useState(false);
  const [newType,setNewType]=useState<DatabaseField["type"]>("text");
  const active=useRef(true);
  const initialRef=useRef(initial);
  const acquire=useCallback(()=>{
    try {
      const raw=localStorage.getItem(key);
      if (raw) {
        if(raw.length>600000) throw new Error("Oversized recovery record.");
        const value=JSON.parse(raw) as Packet;
        if(!/^[0-9a-f-]{36}$/.test(value.id)||value.kind!==initialRef.current.kind||(initialRef.current.expectedRevision>0&&value.id!==initialRef.current.id)||(initialRef.current.kind==="databaseEntries"&&value.databaseId!==initialRef.current.databaseId)||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||typeof value.form?.name!=="string"||typeof value.form.title!=="string"||typeof value.form.description!=="string"||typeof value.form.archived!=="boolean"||(value.operationId!==null&&!/^[0-9a-f-]{36}$/.test(value.operationId))) throw new Error("Invalid recovery record.");
        if(!Array.isArray(value.form.fields)||value.form.fields.length>32||value.form.fields.some(field=>!field||typeof field.id!=="string"||typeof field.name!=="string"||!(databasePropertyTypes as readonly string[]).includes(field.type)||!Array.isArray(field.options)||field.options.some(option=>!option||typeof option.id!=="string"||typeof option.name!=="string"))) throw new Error("Invalid property recovery.");
        noteContent(value.form.content);
        databaseValues(value.form.propertyValues, initialRef.current.form.fields);
        setDraft(value);setDirty(true);
      }
    } catch { setStorageError(true);setUnreadable(true);setDirty(true);setError("This draft could not be read. Download recovery before clearing it."); }
  },[key]);
  const owned=useTaskDraftLock(key,acquire);
  useEffect(()=>{
    active.current=true;
    const element=dialog.current,prior=document.activeElement as HTMLElement|null;
    element?.showModal();element?.querySelector<HTMLInputElement>("input")?.focus();
    return ()=>{active.current=false;element?.close();if(prior?.isConnected)prior.focus();};
  },[]);
  useEffect(()=>{
    let live=true;
    if(entry){
      const ids=[...new Set(database.fields.flatMap(field=>field.targetDatabaseId?[field.targetDatabaseId]:[]))];
      void Promise.all(ids.map(async id=>[id,await relationChoices(request,id)] as const)).then(rows=>{if(live){setTargets(Object.fromEntries(rows));setRelationError("");}}).catch(()=>{if(live)setRelationError("Could not load relation entries. Existing links are preserved.");});
      if(entry.revision)void request(`databaseEntries/${entry.id}`,"GET").then(result=>{if(live){setIncoming(result.incoming);setIncomingTruncated(result.truncated);}}).catch(error=>{if(live)setError(error.message);});
    }
    return ()=>{live=false;};
  },[request,database.fields,entry,relationRefresh]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty||busy||composition){event.preventDefault();}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty,busy,composition]);
  function persist(next:Packet) {
    try { localStorage.setItem(key,JSON.stringify(next));setStorageError(false);return true; }
    catch {setStorageError(true);setError("Draft storage failed. Download recovery or retry saving the draft locally.");return false;}
  }
  function change(patch:Partial<Form>){if(!owned||busy||draft.operationId||storageError)return;const next={...draft,form:{...draft.form,...patch}};persist(next);setDraft(next);setDirty(true);}
  function dismiss(){if(busy||composition)return;if(dirty&&!confirm("Close this editor? Your draft stays on this device for recovery."))return;close();}
  async function save(){
    if(!owned||busy||composition||storageError)return;
    if(!draft.operationId)try {
      if(kind==="databases") {if(!draft.form.name.trim())throw new Error("Enter a database name.");databaseFields(draft.form.fields.map(databaseFieldInput),database.fields);}
      else {if(!draft.form.title.trim())throw new Error("Enter an entry title.");noteContent(draft.form.content);databaseValues(draft.form.propertyValues,database.fields,entry?.propertyValues);}
    }catch(error){setError((error as Error).message);return;}
    const packet={...draft,operationId:draft.operationId??crypto.randomUUID()};
    if(!persist(packet))return;setDraft(packet);setBusy(true);setError("");
    try{
      const form=packet.form;
      const body=kind==="databases"?{name:form.name,description:form.description,fields:form.fields.map(databaseFieldInput),archived:form.archived}:{databaseId:packet.databaseId,title:form.title,content:form.content,propertyValues:form.propertyValues,archived:form.archived};
      await request(`${kind}/${packet.id}`,"PUT",{...body,expectedRevision:packet.expectedRevision,operationId:packet.operationId});
      if(!active.current)return;
      localStorage.removeItem(key);setDirty(false);saved(kind==="databases"?packet.id:packet.databaseId);
    }catch(error){if(active.current)setError(error instanceof Error?error.message:"Save failed. Retry the same save packet.");}
    finally{if(active.current)setBusy(false);}
  }
  const disabled=!owned||busy||Boolean(draft.operationId)||storageError||Boolean(entry&&database.archived);
  const form=draft.form;
  function value(field:DatabaseField,next:PropertyValue){change({propertyValues:{...form.propertyValues,[field.id]:next}});}
  function updateField(index:number,patch:Partial<DatabaseField>){change({fields:form.fields.map((field,i)=>i===index?{...field,...patch}:field)});}
  return <dialog ref={dialog} className={s.dialog} aria-label={entry?"Database entry":"Database properties"} onCancel={event=>{event.preventDefault();dismiss();}}><div className={s.body}>
    <p className={s.muted}>{entry?database.name:"Database properties"}</p>
    <label>{entry?"Title":"Name"}<input disabled={disabled} maxLength={entry?200:80} value={entry?form.title:form.name} onChange={event=>change(entry?{title:event.target.value}:{name:event.target.value})}/></label>
    {!entry&&<><label>Description<textarea disabled={disabled} maxLength={2000} value={form.description} onChange={event=>change({description:event.target.value})}/></label>
      {form.fields.map((field,index)=><div className={s.field} key={field.id}><input aria-label="Property name" disabled={disabled} maxLength={80} value={field.name} onChange={event=>updateField(index,{name:event.target.value})}/><span>{labels[field.type]}</span>{!database.fields.some(old=>old.id===field.id)&&<button disabled={disabled} onClick={()=>change({fields:form.fields.filter(item=>item.id!==field.id)})}>Remove unsaved property</button>}
        {field.type==="relation"&&<><select aria-label="Relation target type" disabled={disabled||database.fields.some(old=>old.id===field.id)} value={field.targetKind??"database"} onChange={event=>{const kind=event.target.value as "database"|"task"|"project";updateField(index,{targetKind:kind==="database"?undefined:kind,targetDatabaseId:kind==="database"?"":undefined});}}><option value="database">Database entries</option><option value="task">Tasks</option><option value="project">Projects</option></select>{(!field.targetKind||field.targetKind==="database")&&<select aria-label="Target database" disabled={disabled||database.fields.some(old=>old.id===field.id)} value={field.targetDatabaseId??""} onChange={event=>updateField(index,{targetDatabaseId:event.target.value})}><option value="">Choose database</option>{[...definitions.filter(item=>item.id!==database.id),{...database,id:draft.id}].map(item=><option key={item.id} value={item.id} disabled={item.archived&&item.id!==field.targetDatabaseId}>{item.name||"This database"}{item.archived?" (archived)":""}</option>)}</select>}</>}
        {["select","multiSelect","status"].includes(field.type)&&<div>{field.options.map((option,i)=><div key={option.id}><input disabled={disabled} aria-label="Option name" value={option.name} maxLength={80} onChange={event=>updateField(index,{options:field.options.map((old,j)=>j===i?{...old,name:event.target.value}:old)})}/>{field.type==="status"&&<select aria-label={`Workflow group for ${option.name}`} disabled={disabled} value={option.group} onChange={event=>updateField(index,{options:field.options.map((old,j)=>j===i?{...old,group:event.target.value as "todo"|"doing"|"done"}:old)})}>{statusGroups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select>}<label><input type="checkbox" disabled={disabled} checked={option.archived??false} onChange={event=>updateField(index,{options:field.options.map((old,j)=>j===i?{...old,archived:event.target.checked}:old)})}/>Archived</label></div>)}<button disabled={disabled||field.options.length>=50} onClick={()=>updateField(index,{options:[...field.options,{id:crypto.randomUUID(),name:`Option ${field.options.length+1}`,...(field.type==="status"?{group:"todo" as const}:{})} ]})}>Add option</button></div>}
      </div>)}
      <div className={s.toolbar}><select disabled={disabled} aria-label="New property type" value={newType} onChange={event=>setNewType(event.target.value as DatabaseField["type"])}>{databasePropertyTypes.map(type=><option key={type} value={type}>{labels[type]}</option>)}</select><button disabled={disabled||form.fields.length>=32} onClick={()=>change({fields:[...form.fields,{id:crypto.randomUUID(),name:`Property ${form.fields.length+1}`,type:newType,options:newType==="status"?statusGroups.map(group=>({id:crypto.randomUUID(),name:group.name,group:group.id})):[],revision:1,...(newType==="relation"?{targetDatabaseId:""}:{})}]})}>Add property</button></div></>}
    {entry&&<>{database.fields.map(field=><div className={s.property} role="group" aria-label={field.name} key={field.id}><span>{field.name}</span><span>{field.type==="relation"?<DatabaseRelationPicker name={field.name} targetName={field.targetKind==="task"?"tasks":field.targetKind==="project"?"projects":definitions.find(item=>item.id===field.targetDatabaseId)?.name??"this database"} entries={field.targetKind==="task"?api.tasks.map(item=>({id:item.id,title:item.title,databaseId:"",content:{blocks:[]},propertyValues:{},archived:false,revision:item.revision??0})):field.targetKind==="project"?api.projects.map(item=>({id:item.id,title:item.name,databaseId:"",content:{blocks:[]},propertyValues:{},archived:item.archived,revision:item.revision})):targets[field.targetDatabaseId!]} selected={Array.isArray(form.propertyValues[field.id])?form.propertyValues[field.id] as string[]:[]} disabled={disabled} targetArchived={definitions.find(item=>item.id===field.targetDatabaseId)?.archived===true} error={field.targetKind==="task"||field.targetKind==="project"?"":relationError} retry={()=>{setTargets({});setRelationError("");setRelationRefresh(value=>value+1);}} onChange={ids=>value(field,ids)}/>
      :field.type==="createdTime"?<span>{createdTimeDisplay(entry)}</span>
      :field.type==="checkbox"?<input aria-label={field.name} type="checkbox" disabled={disabled} checked={form.propertyValues[field.id]===true} onChange={event=>value(field,event.target.checked)}/>
      :field.type==="multiSelect"?<span className={s.choices}>{field.options.map(option=>{const selected=(form.propertyValues[field.id]??[]) as string[];return <label key={option.id}><input type="checkbox" disabled={disabled||(option.archived&&!selected.includes(option.id))} checked={selected.includes(option.id)} onChange={event=>value(field,event.target.checked?[...selected,option.id]:selected.filter(id=>id!==option.id))}/>{option.name}{option.archived?" (archived)":""}</label>;})}</span>
      :field.type==="status"?<select aria-label={field.name} disabled={disabled} value={String(form.propertyValues[field.id]??"")} onChange={event=>value(field,event.target.value||null)}><option value="">No selection</option>{statusGroups.map(group=><optgroup key={group.id} label={group.name}>{field.options.filter(option=>option.group===group.id).map(option=><option key={option.id} value={option.id} disabled={option.archived&&form.propertyValues[field.id]!==option.id}>{option.name}{option.archived?" (archived)":""}</option>)}</optgroup>)}</select>
      :field.type==="select"||field.type==="person"?<select aria-label={field.name} disabled={disabled} value={String(form.propertyValues[field.id]??"")} onChange={event=>value(field,event.target.value||null)}><option value="">No selection</option>{(field.type==="person"?api.members.map(member=>({id:member.id,name:member.displayName,archived:false})):field.options).map(option=><option key={option.id} value={option.id} disabled={option.archived&&form.propertyValues[field.id]!==option.id}>{option.name}{option.archived?" (archived)":""}</option>)}</select>
      :field.type==="longText"?<textarea aria-label={field.name} disabled={disabled} maxLength={10000} value={String(form.propertyValues[field.id]??"")} onChange={event=>value(field,event.target.value||null)}/>
      :<input aria-label={field.name} disabled={disabled} type={field.type==="number"?"number":field.type==="date"?"date":field.type==="url"?"url":field.type==="email"?"email":field.type==="phone"?"tel":"text"} step="any" maxLength={2000} value={String(form.propertyValues[field.id]??"")} onChange={event=>value(field,event.target.value===""?null:field.type==="number"?Number(event.target.value):event.target.value)}/>}
    </span></div>)}<BlockEditor value={form.content} disabled={disabled} allowedBlockTypes={taskBlockTypes} onChange={content=>change({content})} onCompositionPendingChange={setComposition}/>
    <div className={s.incoming}><p>Linked from</p>{incoming.length?incoming.map(link=><p key={`${link.entryId}:${link.fieldId}`}><button disabled={busy||composition} onClick={()=>{if(!dirty||confirm("Open the linked entry? Your draft stays on this device."))openEntry(link.entryId);}}>{link.title}</button> · {link.fieldName}{link.archived?" (archived)":""}</p>):<p className={s.muted}>No incoming links.</p>}{incomingTruncated&&<p>Showing the first 200 incoming links.</p>}</div></>}
    <label>Archived<input type="checkbox" disabled={disabled} checked={form.archived} onChange={event=>change({archived:event.target.checked})}/></label>
    {!owned&&<p className={s.muted}>Waiting for this draft’s editor lock. Close the other editor to continue. Browser Web Locks are required.</p>}
    {error&&<p role="alert" className={s.error}>{error}</p>}
    {draft.operationId&&<p className={s.muted}>This save is frozen for safe retry. For a rejected save, download your draft, then reopen the latest record before applying changes.</p>}
  </div><div className={s.footer}><button disabled={composition} onClick={()=>download("database-draft.json",unreadable?localStorage.getItem(key):draft)}>Download draft</button>{storageError&&!unreadable&&<button disabled={!owned} onClick={()=>{if(persist(draft))setError("");}}>Retry local storage</button>}{owned&&dirty&&!busy&&<button disabled={composition} onClick={()=>{download("database-draft.json",unreadable?localStorage.getItem(key):draft);localStorage.removeItem(key);close();}}>Download and discard draft</button>}<button disabled={busy||composition} onClick={dismiss}>Close</button><button disabled={!owned||busy||storageError||composition||Boolean(entry&&database.archived)} onClick={()=>void save()}>{busy?"Saving…":draft.operationId?"Retry same save":"Save"}</button></div></dialog>;
}

export default function Databases({ api, onTask, onProject }: { api:Api; onTask:(task:Task)=>void; onProject:(id:string)=>void }) {
  const request=api.databaseRequest;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [definitions,setDefinitions]=useState<DatabaseDefinition[]>([]);
  const [selection,setSelection]=useState("");
  const [database,setDatabase]=useState<DatabaseDefinition|null>(null);
  const [entries,setEntries]=useState<DatabaseEntry[]>([]);
  const [targets,setTargets]=useState<Record<string,DatabaseEntry>>({});
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [refresh,setRefresh]=useState(0);
  const [editor,setEditor]=useState<{database:DatabaseDefinition;entry?:DatabaseEntry}|null>(null);
  const [archives,setArchives]=useState(false);
  const [search,setSearch]=useState("");
  const [layout,setLayout]=useState<"table"|"list">("table");
  const [tableSort,setTableSort]=useState<{databaseId:string;sort:TableSort}|null>(null);
  const [truncated,setTruncated]=useState(false);
  const [cursor,setCursor]=useState<string|null>(null);
  const [paging,setPaging]=useState(false);
  const viewGeneration=useRef(0);
  const expanded=useRef(false);
  async function loadMore(){
    if(!cursor||!database||paging)return;
    const generation=viewGeneration.current;
    expanded.current=true;
    setPaging(true);
    try{
      const result=await request(`databases/${database.id}?cursor=${cursor}`,"GET");
      if(alive.current&&generation===viewGeneration.current){setEntries(before=>[...new Map([...before,...result.entries].map(entry=>[entry.id,entry])).values()] as DatabaseEntry[]);setCursor(result.nextCursor);setTruncated(result.truncated);}
    }catch(error){if(alive.current&&generation===viewGeneration.current)setError((error as Error).message);}
    finally{if(alive.current&&generation===viewGeneration.current)setPaging(false);}
  }
  function openEntry(id:string) {
    const intended=editor;
    void request(`databaseEntries/${id}`,"GET").then(result=>{
      if(!alive.current)return;
      const targetDatabase=definitions.find(item=>item.id===result.entry.databaseId);
      if(targetDatabase)setEditor(current=>current===intended?{database:targetDatabase,entry:result.entry}:current);
    }).catch(error=>{if(alive.current)setError(error.message);});
  }
  useEffect(()=>{
    let live=true;
    let sequence=0;
    const generation=++viewGeneration.current;
    expanded.current=false;
    const load=async()=>{
      const read=++sequence;
      try{
        const list=await request("databases","GET");
        if(!live||read!==sequence)return;setDefinitions(list.databases);
        const selected=selection||list.databases.find((item:DatabaseDefinition)=>!item.archived)?.id;
        if(selected){
          const result=await request(`databases/${selected}`,"GET");
          const related=await Promise.all([...new Set((result.database as DatabaseDefinition).fields.flatMap(field=>field.targetDatabaseId?[field.targetDatabaseId]:[]))].map(id=>relationChoices(request,id)));
          if(!live||read!==sequence||expanded.current)return;setDatabase(result.database);setEntries(result.entries);setCursor(result.nextCursor);setTruncated(result.truncated);setPaging(false);setTargets(Object.fromEntries(related.flatMap(rows=>rows.map(entry=>[entry.id,entry]))));
        }else{setDatabase(null);setEntries([]);}
        if(live&&read===sequence){setError("");setLoading(false);}
      }catch(error){if(live&&read===sequence){setError(error instanceof Error?error.message:"Could not load databases.");setLoading(false);}}
    };
    void load();const timer=setInterval(()=>{if(!expanded.current)void load();},30000);
    return()=>{live=false;viewGeneration.current=generation+1;clearInterval(timer);};
  },[request,selection,refresh]);
  const columns=databaseColumns(database?.fields??[]);
  const sort=tableSort&&tableSort.databaseId===database?.id&&columns.some(column=>column.id===tableSort.sort.column)?tableSort.sort:null;
  const visible=sortDatabaseEntries(entries.filter(entry=>(archives||!entry.archived)&&entry.title.toLowerCase().includes(search.toLowerCase())),sort,database?.fields??[],api.members,targets,{tasks:api.tasks,projects:api.projects});
  function relationLink(field:DatabaseField,id:string) {
    const task=field.targetKind==="task"?api.tasks.find(item=>item.id===id):undefined;
    const project=field.targetKind==="project"?api.projects.find(item=>item.id===id):undefined;
    const title=field.targetKind==="task"?task?.title??"Unavailable task":field.targetKind==="project"?project?.name??"Unavailable project":targets[id]?.title??"Unavailable entry";
    return <button key={id} onClick={()=>{if(field.targetKind==="task"){if(task)onTask(task);}else if(field.targetKind==="project"){if(project)onProject(project.id);}else openEntry(id);}} disabled={field.targetKind==="task"?!task:field.targetKind==="project"?!project:false}>{title}</button>;
  }
  function toggleSort(column:string){
    if(!database)return;
    const current=sort??{column:"title",direction:"ascending"};
    setTableSort(current.column===column&&current.direction==="descending"?null:{databaseId:database.id,sort:{column,direction:current.column===column?"descending":"ascending"}});
  }
  return <section aria-label="Databases"><div className={s.toolbar}><select aria-label="Choose database" value={database?.id??""} onChange={event=>{setLoading(true);setTableSort(null);setSelection(event.target.value);}}><option value="" disabled>Choose database</option>{definitions.map(item=><option key={item.id} value={item.id}>{item.name}{item.archived?" (archived)":""}</option>)}</select><button onClick={()=>setEditor({database:{id:crypto.randomUUID(),name:"",description:"",fields:[],archived:false,revision:0}})}>New database</button>{database&&<><button onClick={()=>setEditor({database})}>Properties</button><button disabled={database.archived} onClick={()=>setEditor({database,entry:{id:crypto.randomUUID(),databaseId:database.id,title:"",content:{blocks:[{type:"paragraph",text:""}]},propertyValues:{},archived:false,revision:0}})}>Add entry</button><button disabled={loading} onClick={()=>download("database.json",{version:1,database,entries,truncated})}>Export loaded JSON</button></>}<button onClick={()=>setRefresh(value=>value+1)}>Refresh</button></div>
    {error&&<p role="alert" className={s.error}>{error}</p>}{loading&&<p role="status">Loading databases…</p>}
    {database&&<><p>{database.description}</p><div className={s.toolbar}><input aria-label="Search entries" placeholder="Search entries" value={search} onChange={event=>setSearch(event.target.value)}/><label><input type="checkbox" checked={archives} onChange={event=>setArchives(event.target.checked)}/> Show archived entries</label><div role="group" aria-label="Database layout"><button type="button" aria-pressed={layout==="table"} onClick={()=>setLayout("table")}>Table</button><button type="button" aria-pressed={layout==="list"} onClick={()=>setLayout("list")}>List</button></div>{layout==="list"&&<><label>Sort by <select value={sort?.column??"title"} onChange={event=>setTableSort({databaseId:database.id,sort:{column:event.target.value,direction:sort?.direction??"ascending"}})}>{columns.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label><button type="button" onClick={()=>setTableSort({databaseId:database.id,sort:{column:sort?.column??"title",direction:sort?.direction==="descending"?"ascending":"descending"}})} aria-label={`Sort direction: ${sort?.direction??"ascending"}`}>{sort?.direction==="descending"?"Descending ↓":"Ascending ↑"}</button></>}<span className={s.muted} role="status">{visible.length} of {entries.length} loaded entries · {sort?`${columns.find(column=>column.id===sort.column)?.label}, ${sort.direction}`:"Title, ascending"}{truncated?" · More entries available":""}</span>{sort&&<button onClick={()=>setTableSort(null)}>Reset sort</button>}</div>{layout==="table"?<div className={s.scroll} tabIndex={0} role="region" aria-label="Database table"><table className={s.table}><thead><tr>{columns.map(column=><th scope="col" key={column.id} aria-sort={sort?.column===column.id?sort.direction:!sort&&column.id==="title"?"ascending":"none"}><button onClick={()=>toggleSort(column.id)} aria-label={`Sort by ${column.label}`}>{column.label}{sort?.column===column.id?(sort.direction==="ascending"?" ↑":" ↓"):!sort&&column.id==="title"?" ↑":""}</button></th>)}</tr></thead><tbody>{visible.map(entry=><tr key={entry.id}><td><button onClick={()=>setEditor({database,entry})}>{entry.title}{entry.archived?" (archived)":""}</button></td>{database.fields.map(field=><td key={field.id}>{field.type==="relation"?(Array.isArray(entry.propertyValues[field.id])?(entry.propertyValues[field.id] as string[]):[]).map(id=>relationLink(field,id)):field.type==="createdTime"?createdTimeDisplay(entry):propertyDisplay(field,entry.propertyValues[field.id],api.members)}</td>)}</tr>)}</tbody></table></div>:<ul className={s.entryList} aria-label="Database entries">{!visible.length&&<li className={s.muted}>No matching entries in the loaded results.</li>}{visible.map(entry=><li key={entry.id}><button className={s.entryTitle} onClick={()=>setEditor({database,entry})}>{entry.title}{entry.archived?" (archived)":""}</button>{database.fields.length>0&&<dl>{database.fields.map(field=><div key={field.id}><dt>{field.name}</dt><dd>{field.type==="relation"?(Array.isArray(entry.propertyValues[field.id])?(entry.propertyValues[field.id] as string[]):[]).map(id=>relationLink(field,id)):field.type==="createdTime"?createdTimeDisplay(entry):propertyDisplay(field,entry.propertyValues[field.id],api.members)}</dd></div>)}</dl>}</li>)}</ul>}</>}
    {cursor&&<button disabled={paging} onClick={()=>void loadMore()}>{paging?"Loading…":"Load more entries"}</button>}
    {!loading&&!database&&<p>Create a database for clients, documents, inventory or any other collection.</p>}
    {editor&&<Editor key={`${editor.entry?.id??editor.database.id}`} api={api} database={editor.database} entry={editor.entry} definitions={definitions} close={()=>setEditor(null)} openEntry={openEntry} saved={id=>{setSelection(id);setEditor(null);setRefresh(value=>value+1);}}/>}
  </section>;
}
