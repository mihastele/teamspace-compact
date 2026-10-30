"use client";

import { useCallback, useEffect, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import { useTaskDraftLock } from "@/lib/use-task-draft-lock";
import type { DatabaseDefinition, DatabaseEntry } from "@/lib/databases";
import type { EntityRelationField, EntityRelationScope, EntityRelationValues } from "@/lib/entity-database-relations";
import DatabaseRelationPicker from "./DatabaseRelationPicker";
import s from "./Databases.module.css";

type Api = ReturnType<typeof useTeamspace>;
async function choices(request:Api["databaseRequest"],id:string) {
  const entries:DatabaseEntry[]=[]; let cursor:string|null=null;
  do { const page=await request(`databases/${id}?summary=1${cursor?`&cursor=${cursor}`:""}`,"GET"); entries.push(...page.entries); if(page.nextCursor===cursor&&cursor)throw new Error("Could not advance relation choices."); cursor=page.nextCursor; } while(cursor&&entries.length<1000);
  return entries;
}

export default function EntityDatabaseRelations({api,scope,values,disabled,onChange,readOnly=false}:{api:Api;scope:EntityRelationScope;values:EntityRelationValues;disabled:boolean;onChange:(values:EntityRelationValues)=>void;readOnly?:boolean}) {
  const request=api.databaseRequest;
  const [fields,setFields]=useState<EntityRelationField[]>([]),[databases,setDatabases]=useState<DatabaseDefinition[]>([]),[targets,setTargets]=useState<Record<string,DatabaseEntry[]>>({});
  const [error,setError]=useState(""),[loadError,setLoadError]=useState(""),[refresh,setRefresh]=useState(0),[creating,setCreating]=useState(false),[name,setName]=useState(""),[target,setTarget]=useState(""),[sourceSearch,setSourceSearch]=useState("");
  const [packet,setPacket]=useState<{id:string;name:string;targetDatabaseId:string;operationId:string}|null>(null),[busy,setBusy]=useState(false);
  const [storageError,setStorageError]=useState(false);
  const key=`teamspace:entity-relation-field:v1:${api.user?.uid}:${api.workspace?.id}:${scope}${readOnly?":view":""}`;
  const acquire=useCallback(()=>{
    try {
      const raw=localStorage.getItem(key); if(!raw)return;
      const value=JSON.parse(raw), id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if(!value||!id.test(value.id)||!id.test(value.targetDatabaseId)||!id.test(value.operationId)||typeof value.name!=="string"||!value.name.trim()||value.name.length>80)throw new Error("Invalid property recovery.");
      setPacket(value);setName(value.name);setTarget(value.targetDatabaseId);setCreating(true);
    } catch {setStorageError(true);setError("Property recovery could not be read. The stored record is unchanged.");}
  },[key]);
  const owned=useTaskDraftLock(key,acquire);
  useEffect(()=>{
    let live=true;
    void Promise.all([request("entityRelationFields","GET"),request("databases","GET")]).then(async ([definitions,list])=>{
      const selected=(definitions.fields as EntityRelationField[]).filter(field=>field.scope===scope);
      if(live){setFields(selected);setDatabases(list.databases);}
      const loaded=await Promise.all([...new Set(selected.map(field=>field.targetDatabaseId))].map(async id=>[id,await choices(request,id)] as const));
      if(live){setTargets(Object.fromEntries(loaded));setLoadError("");}
    }).catch(()=>{if(live)setLoadError("Could not load relation properties. Your page draft is preserved.");});
    return ()=>{live=false;};
  },[request,scope,refresh]);
  async function add(){
    if(disabled||busy||!owned||storageError)return;
    const next=packet??{id:crypto.randomUUID(),name:name.trim(),targetDatabaseId:target,operationId:crypto.randomUUID()};
    if(!next.name||!next.targetDatabaseId){setError("Enter a name and choose a data source.");return;}
    try { localStorage.setItem(key,JSON.stringify(next)); } catch {setStorageError(true);setError("Property recovery could not be stored. No request was sent.");return;}
    setPacket(next);setBusy(true);setError("");
    try {await request(`entityRelationFields/${next.id}`,"PUT",{name:next.name,targetDatabaseId:next.targetDatabaseId,operationId:next.operationId,scope,expectedRevision:0});try{localStorage.removeItem(key);}catch{/* An accepted retry remains safe. */}setPacket(null);setName("");setTarget("");setSourceSearch("");setCreating(false);setRefresh(value=>value+1);}
    catch(error){const status=typeof error==="object"&&error!==null&&"status" in error?error.status:undefined;if(typeof status==="number"&&status>=400&&status<500){try{localStorage.removeItem(key);setPacket(null);}catch{setStorageError(true);}}setError(error instanceof Error?error.message:"Could not save the property. Retry the same request.");}
    finally{setBusy(false);}
  }
  return <section aria-label={`${scope === "task" ? "Task" : "Project"} data-source relations`}>
    {fields.map(field=><div className={s.property} key={field.id}><span>{field.name}</span><DatabaseRelationPicker name={field.name} targetName={databases.find(item=>item.id===field.targetDatabaseId)?.name??"data source"} entries={targets[field.targetDatabaseId]} selected={values[field.id]??[]} disabled={disabled} targetArchived={databases.find(item=>item.id===field.targetDatabaseId)?.archived===true} error={loadError} retry={()=>setRefresh(value=>value+1)} onChange={ids=>onChange({...values,[field.id]:ids})}/></div>)}
    {loadError&&fields.length===0&&<p role="alert">{loadError} <button type="button" onClick={()=>setRefresh(value=>value+1)}>Retry</button></p>}
    {error&&<p role="alert">{error}</p>}
    {storageError&&<div className={s.field}><button type="button" onClick={()=>{try{const raw=localStorage.getItem(key)??"No stored property recovery record";const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="relation-property-recovery.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError("Property recovery could not be downloaded.");}}}>Download property recovery</button><button type="button" disabled={!owned} onClick={()=>{if(!confirm("Discard the stored property recovery record? Download it first if needed. A previous request may have succeeded; refresh before creating it again."))return;try{localStorage.removeItem(key);setStorageError(false);setPacket(null);setError("");}catch{setError("Property recovery could not be cleared.");}}}>Discard property recovery</button></div>}
    {!readOnly&&!owned&&<p className={s.muted}>Property creation is unavailable while another tab owns its recovery lock.</p>}
    {!readOnly&&(!creating?<button type="button" disabled={disabled||!owned||storageError} onClick={()=>setCreating(true)}>+ Add data-source relation</button>:<div className={s.field}>
      <label>Property name<input value={name} maxLength={80} disabled={busy||Boolean(packet)} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}}/></label>
      <label>Search data sources<input type="search" value={sourceSearch} disabled={busy||Boolean(packet)} onChange={event=>setSourceSearch(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}}/></label>
      <label>Data source<select value={target} disabled={busy||Boolean(packet)} onChange={event=>setTarget(event.target.value)}><option value="">Choose a database</option>{databases.filter(item=>!item.archived&&(item.id===target||item.name.toLocaleLowerCase().includes(sourceSearch.trim().toLocaleLowerCase()))).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" disabled={disabled||busy||!owned||storageError} onClick={()=>void add()}>{packet?"Retry property":"Create property"}</button>
      <button type="button" disabled={busy||Boolean(packet)} onClick={()=>{setCreating(false);setName("");setTarget("");setSourceSearch("");}}>Cancel</button>
      <small>Property definitions are shared; selected links save with this page.</small>
    </div>)}
  </section>;
}
