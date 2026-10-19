"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { BoardView, Task } from "@/lib/model";
import { defaultBoardView } from "@/lib/linked-content";
import { defaultTicketViews, validateViewConfig, mergeSavedViews, ticketViewUrl, type SavedView, type ViewConfig } from "@/lib/ticket-query";
import { propertyDisplay } from "@/lib/board-properties";
import { statusLabels } from "@/lib/task-table";
import TicketFilters, { queryFields } from "./TicketFilters";
import NewNamedBoard from "./NewNamedBoard";

import s from "./TicketViews.module.css";
type Api=ReturnType<typeof useTeamspace>;
const configOf=(view:ViewConfig):ViewConfig=>({name:view.name,layout:view.layout,groupBy:view.groupBy,columns:view.columns,query:view.query});

export function SavedViewLink({api,view,disabled,onApply}: {api:Api;view?:BoardView;disabled:boolean;onApply:(next:BoardView,baseline:BoardView|undefined)=>void}){
  const [views,setViews]=useState<SavedView[]>([]),[error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const {projectsEnabled,listViews}=api;
  useEffect(()=>{let active=true;if(projectsEnabled)listViews().then(rows=>{if(active)setViews(rows);}).catch(()=>{if(active)setError("Saved views could not be loaded.");});return()=>{active=false;};},[projectsEnabled,listViews]);
  const available=mergeSavedViews(api.savedViews,views);
  if(!api.projectsEnabled)return null;
  return <div className={s.views}><div className={s.controls}>
    <label>Named board / saved view<select disabled={disabled} value={view?.savedViewId??""} onChange={event=>{try{const next={...(view??defaultBoardView)};if(event.target.value)next.savedViewId=event.target.value;else delete next.savedViewId;onApply(next,view);setError("");}catch(error){setError(error instanceof Error?error.message:"View could not be linked.");}}}>
      <option value="">This block’s basic settings</option>
      {view?.savedViewId&&!available.some(item=>item.id===view.savedViewId)&&<option value={view.savedViewId}>Unavailable saved view</option>}
      {available.map(item=><option key={item.id} value={item.id} disabled={item.archived&&item.id!==view?.savedViewId}>{item.name}{item.archived?" (archived)":""}</option>)}
    </select></label>
    <button type="button" disabled={disabled} onClick={()=>setCreating(true)}>New named board</button>
    <button type="button" disabled={disabled} onClick={async()=>{try{setViews(await listViews());setError("");}catch{setError("Saved views could not be loaded. Try refreshing boards again.");}}}>Refresh boards</button>
  </div>
    {!view?.savedViewId&&<p className={s.hint}>Choose or create a named board to filter by ticket properties and linked Projects. Each block can show a different board over the same tickets.</p>}
    {creating&&<NewNamedBoard api={api} initial={view} disabled={disabled} onApply={onApply} onCreated={row=>setViews(previous=>mergeSavedViews(previous,[row]))} close={()=>setCreating(false)}/>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export default function TicketViews({api,onTask,viewId,disabled=false,onLink}: {api:Api;onTask:(task:Partial<Task>)=>void;viewId?:string;disabled?:boolean;onLink?:(id:string)=>void}){
  const [views,setViews]=useState<SavedView[]>([]),[selected,setSelected]=useState<SavedView|null>(null);
  const [config,setConfig]=useState<ViewConfig|null>(null),[draft,setDraft]=useState<ViewConfig|null>(null);
  const [projectId,setProjectId]=useState("");
  const [tasks,setTasks]=useState<Task[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [refresh,setRefresh]=useState(0),[showArchived,setShowArchived]=useState(false);
  const [pending,setPending]=useState<{id:string;patch:Partial<Task>;acknowledged:boolean}|null>(null);
  const requestSequence=useRef(0),creation=useRef<{digest:string;id:string;row?:SavedView}|null>(null);
  const saveScope=useRef(0),savingRef=useRef(false);
  useLayoutEffect(()=>{const scope=saveScope;scope.current++;return()=>{scope.current++;};},[api.saveView,viewId]);
  const linkState=useRef({onLink,disabled});
  useLayoutEffect(()=>{linkState.current={onLink,disabled};},[onLink,disabled]);
  const embedded=Boolean(viewId);
  const fields=queryFields(api.boardProperties,api.projects);
  const schemaSignature=api.boardProperties.map(field=>`${field.id}:${field.revision}`).join(";");
  const taskSignature=api.tasks.map(task=>`${task.id}:${task.revision??0}`).join(";");
  const properties=api.boardProperties;
  const viewSignature=api.savedViews.map(view=>`${view.id}:${view.revision}`).join(";");
  useEffect(()=>{
    let active=true;
    api.listViews().then(rows=>{
      if(!active)return;setViews(rows);
      const params=new URLSearchParams(location.search),wanted=viewId??params.get("ticketView");
      const row=rows.find(row=>row.id===wanted)??(!wanted?rows.find(row=>!row.archived):undefined);
      if(wanted&&wanted!=="unsaved"&&!row){setError("This saved view is unavailable. Its tasks have not been deleted.");return;}
      let initial=configOf(row??defaultTicketViews()[0]);
      if(!viewId&&params.has("ticketQuery"))try{initial=validateViewConfig(JSON.parse(params.get("ticketQuery")!),properties);}catch{setSelected(null);setConfig(null);setDraft(null);setError("The URL view settings are invalid. Choose a saved view to continue.");return;}
      setProjectId(!viewId?params.get("project")??"":"");setSelected(row??null);setConfig(initial);setDraft(initial);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:"Views could not be loaded.");});
    return()=>{active=false;};
    // Properties are the settled workspace schema when this component mounts.
    // Later schema changes invalidate the query separately without discarding edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api.listViews,viewId]);
  useEffect(()=>{
    if(!selected)return;
    const latest=api.savedViews.find(view=>view.id===selected.id);
    if(!latest||latest.revision<=selected.revision)return;
    queueMicrotask(()=>{
      setViews(api.savedViews);
      if(config&&draft&&JSON.stringify(config)===JSON.stringify(configOf(selected))&&JSON.stringify(draft)===JSON.stringify(config)){
        const next=configOf(latest);setSelected(latest);setConfig(next);setDraft(next);
      }else setError("The saved view changed. Reopen it to review the latest settings before saving.");
    });
  },[viewSignature,api.savedViews,selected,config,draft,embedded]);
  useEffect(()=>{
    const timer=setInterval(()=>setRefresh(value=>value+1),60000);
    const visible=()=>{if(document.visibilityState==="visible")setRefresh(value=>value+1);};
    document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[]);
  const queryTickets=api.queryTickets;
  const listed=mergeSavedViews(api.savedViews,views);
  const reload=useCallback(async(nextConfig:ViewConfig,project:string,after?:string)=>{
    return queryTickets(nextConfig.query,after,project||undefined);
  },[queryTickets]);
  useEffect(()=>{
    if(!config)return;
    const sequence=++requestSequence.current;let active=true;
    queueMicrotask(()=>{if(active){setBusy(true);setTasks([]);setCursor(null);setError("");}});
    reload(config,projectId).then(result=>{if(active&&sequence===requestSequence.current){setTasks(result.tasks);setCursor(result.nextCursor);setPending(previous=>previous?.acknowledged?null:previous);}}).catch(error=>{if(active)setError(error instanceof Error?error.message:"View could not be loaded.");}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[config,projectId,refresh,schemaSignature,taskSignature,reload]);
  function remember(next:ViewConfig,id=selected?.id??"unsaved",project=projectId,persisted=false){
    if(embedded)return;
    try{const saved=persisted||(selected?.id===id&&JSON.stringify(configOf(selected))===JSON.stringify(next));history.replaceState(null,"",ticketViewUrl(location.href,api.workspace!.id,id,project,saved?undefined:next));setNotice("");}catch(error){setNotice(error instanceof Error?error.message:"View URL could not be updated.");}
  }
  function choose(row:SavedView){if(draft&&config&&(JSON.stringify(draft)!==JSON.stringify(config)||(selected&&JSON.stringify(config)!==JSON.stringify(configOf(selected))))&&!confirm("Discard unapplied view settings?"))return;setSelected(row);const next=configOf(row);setConfig(next);setDraft(next);remember(next,row.id,projectId,true);}
  async function save(asNew:boolean){
    if(!draft||disabled||savingRef.current)return;
    const scope=saveScope.current;
    savingRef.current=true;setSaving(true);setError("");
    try{
      const valid=validateViewConfig(draft,api.boardProperties),digest=JSON.stringify(valid);
      if(!creation.current||creation.current.digest!==digest)creation.current={digest,id:crypto.randomUUID()};
      const creating=asNew||!selected;
      const row=creating?(creation.current.row??await api.saveView(valid,{operationId:creation.current.id})):await api.saveView(valid,{id:selected!.id,expectedRevision:selected!.revision});
      if(scope!==saveScope.current)return;
      if(creating)creation.current.row=row;
      setViews(previous=>mergeSavedViews(previous,[row]));
      if(embedded&&asNew){
        if(linkState.current.disabled)throw new Error("The view was saved. Wait until the note is editable before linking it.");
        linkState.current.onLink?.(row.id);
      }
      creation.current=null;setSelected(row);setConfig(configOf(row));setDraft(configOf(row));remember(configOf(row),row.id,projectId,true);
    }catch(error){if(scope===saveScope.current)setError(error instanceof Error?error.message:"View could not be saved. Your settings are still here.");}
    finally{savingRef.current=false;if(scope===saveScope.current)setSaving(false);}
  }
  async function move(task:Task,value:string){
    if(pending||!config)return;
    const patch:Partial<Task>=config.groupBy==="priority"?{priority:value as Task["priority"]}:{status:value as Task["status"]};
    setPending({id:task.id,patch,acknowledged:false});setError("");
    try{if(patch.status)await api.setTaskStatus(task.id,patch.status);else await api.saveTask({id:task.id,...patch});setPending({id:task.id,patch,acknowledged:true});setRefresh(value=>value+1);}
    catch(error){setPending(null);setError(error instanceof Error?error.message:"Move failed. Refresh to review the latest task.");}
  }
  function cell(task:Task,column:string){
    if(column.startsWith("custom:")){const property=api.boardProperties.find(field=>`custom:${field.id}`===column);return property?propertyDisplay(property,task.propertyValues?.[property.id],api.members,api.projects):"Unavailable field";}
    if(column==="status")return statusLabels[task.status];
    if(column==="assigneeId")return api.members.find(member=>member.id===task.assigneeId)?.displayName??"";
    if(column==="projectId")return api.projects.find(project=>project.id===task.projectId)?.name??"";
    return String(task[column as keyof Task]??"");
  }
  const shown=tasks.map(task=>pending?.id===task.id?{...task,...pending.patch}:task);
  const groups=!config||config.groupBy==="none"?[{id:"all",name:"Tasks"}]:config.groupBy==="status"?Object.entries(statusLabels).map(([id,name])=>({id,name})):["none","low","medium","high","urgent"].map(id=>({id,name:id}));
  return <section className={s.views} aria-label={embedded?"Linked saved view":"Saved ticket views"}>
    {!embedded&&<div className={s.controls}>
      <label>Saved view<select disabled={saving||disabled} value={selected?.id??""} onChange={event=>{const row=listed.find(row=>row.id===event.target.value);if(row)choose(row);}}><option value="">Unsaved view</option>{listed.filter(view=>showArchived||!view.archived||view.id===selected?.id).map(view=><option key={view.id} value={view.id}>{view.name}{view.archived?" (archived)":""}</option>)}</select></label>
      <button disabled={!selected||saving} onClick={async()=>{if(!selected)return;try{const rows=await api.listViews();setViews(rows);const row=rows.find(row=>row.id===selected.id);if(row)choose(row);else setError("Saved view is unavailable.");}catch(error){setError(error instanceof Error?error.message:"Saved settings could not be reloaded.");}}}>Reopen saved settings</button>
      <label><input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/> Show archived</label>
      <button disabled={saving} onClick={async()=>{setSaving(true);try{await api.seedViews();setViews(await api.listViews());setError("");}catch(error){setError(error instanceof Error?error.message:"Default views could not be created.");}finally{setSaving(false);}}}>Add default views</button>
      {selected&&<button disabled={saving} onClick={async()=>{setSaving(true);try{const row=await api.saveView(configOf(selected),{id:selected.id,expectedRevision:selected.revision,archived:!selected.archived});setSelected(row);setViews(previous=>previous.map(item=>item.id===row.id?row:item));}catch(error){setError(error instanceof Error?error.message:"View could not be archived.");}finally{setSaving(false);}}}>{selected.archived?"Restore view":"Archive view"}</button>}
    </div>}
    {config&&<><h2>{config.name}{selected?.archived?" (archived)":""}</h2>
      <div className={s.controls}><label>Selected Project<select value={projectId} onChange={event=>{setProjectId(event.target.value);remember(config,selected?.id,event.target.value);}}><option value="">Choose a Project</option>{api.projects.map(project=><option key={project.id} value={project.id}>{project.name}{project.archived?" (archived)":""}</option>)}</select></label><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh results</button></div>
      {embedded&&<div className={s.controls}><p className={s.hint}>Filters and presentation are shared with every note using this named view. Save as new view to give this block its own settings.</p><button type="button" disabled={saving||disabled} onClick={async()=>{try{const rows=await api.listViews();setViews(rows);const row=rows.find(row=>row.id===viewId);if(row)choose(row);else setError("Saved view is unavailable.");}catch{setError("Saved settings could not be reloaded.");}}}>Reopen saved settings</button></div>}
      {draft&&<details><summary>Filters and presentation{JSON.stringify(draft)!==JSON.stringify(config)?" · Unapplied changes":""}</summary>
        <fieldset disabled={saving||disabled||Boolean(selected?.archived)}><div className={s.controls}>
          <label>View name<input maxLength={80} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
          <label>Layout<select value={draft.layout} onChange={event=>setDraft({...draft,layout:event.target.value as ViewConfig["layout"],...(event.target.value==="board"&&draft.groupBy==="none"?{groupBy:"status"}:{} )})}><option value="board">Board</option><option value="table">Table</option><option value="list">List</option></select></label>
          <label>Group by<select value={draft.groupBy} onChange={event=>setDraft({...draft,groupBy:event.target.value as ViewConfig["groupBy"]})}>{draft.layout!=="board"&&<option value="none">No grouping</option>}<option value="status">Status</option><option value="priority">Priority</option></select></label>
          <label>Date timezone<input maxLength={80} value={draft.query.timeZone} placeholder="Europe/Ljubljana" onChange={event=>setDraft({...draft,query:{...draft.query,timeZone:event.target.value}})}/></label>
        </div>
        <p className={s.hint}>Dates follow this view’s timezone. “This week” includes today through seven days from today. Empty values also match negative comparisons. Filters search historical archived options too.</p>
        <TicketFilters properties={api.boardProperties} members={api.members} projects={api.projects} filter={draft.query.filter} onChange={filter=>setDraft({...draft,query:{...draft.query,filter}})}/>
        <fieldset><legend>Sorts (in order)</legend>{draft.query.sort.map((sort,index)=><div className={s.controls} key={index}><label>Sort field<select value={sort.field} onChange={event=>setDraft({...draft,query:{...draft.query,sort:draft.query.sort.map((item,i)=>i===index?{...item,field:event.target.value}:item)}})}>{fields.filter(field=>!api.boardProperties.some(property=>`custom:${property.id}`===field.id&&property.type==="multiSelect")).map(field=><option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label>Direction<select value={sort.direction} onChange={event=>setDraft({...draft,query:{...draft.query,sort:draft.query.sort.map((item,i)=>i===index?{...item,direction:event.target.value as "asc"|"desc"}:item)}})}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><button onClick={()=>setDraft({...draft,query:{...draft.query,sort:draft.query.sort.filter((_,i)=>i!==index)}})}>Remove sort</button></div>)}<button disabled={draft.query.sort.length>=3} onClick={()=>setDraft({...draft,query:{...draft.query,sort:[...draft.query.sort,{field:fields.find(field=>!draft.query.sort.some(sort=>sort.field===field.id)&&!api.boardProperties.some(property=>`custom:${property.id}`===field.id&&property.type==="multiSelect"))!.id,direction:"asc"}]}})}>+ Sort</button></fieldset>
        <fieldset><legend>Visible fields</legend><div className={s.columns}>{fields.map(field=><label key={field.id}><input type="checkbox" disabled={field.id==="title"} checked={draft.columns.includes(field.id)} onChange={event=>setDraft({...draft,columns:event.target.checked?[...draft.columns,field.id]:draft.columns.filter(id=>id!==field.id)})}/>{field.name}</label>)}</div></fieldset>
        <div className={s.controls}><button onClick={()=>{try{const valid=validateViewConfig(draft,api.boardProperties);setConfig(valid);remember(valid);setError("");}catch(error){setError(error instanceof Error?error.message:"Invalid settings.");}}}>Apply settings</button><button onClick={()=>void save(false)}>Save {selected?"changes":"view"}</button><button onClick={()=>void save(true)}>Save as new view</button><button onClick={()=>setDraft(config)}>Discard unapplied settings</button></div>
        </fieldset>
      </details>}
      <p className={s.hint} role="status">{busy?"Loading results…":`${shown.length} tasks loaded${cursor?" · More available":""}`} · {config.query.timeZone}. Results refresh after task changes and once a minute. Paging follows current data; refresh after concurrent reordering.</p>
      <div className={config.layout==="board"?s.board:undefined}>{groups.map(group=>{
        const rows=shown.filter(task=>config.groupBy==="none"||String(task[config.groupBy]??"none")===group.id);
        return <section key={group.id} className={config.layout==="board"?s.column:undefined} aria-label={group.name} onDragOver={event=>{if(config.layout==="board")event.preventDefault();}} onDrop={event=>{if(config.layout!=="board")return;event.preventDefault();const id=event.dataTransfer.getData("text/teamspace-ticket"),task=tasks.find(task=>task.id===id);if(task)void move(task,group.id);}}>
          {config.groupBy!=="none"&&<h3>{group.name} ({rows.length})</h3>}
          {config.layout==="table"?<div className={s.scroll} tabIndex={0} role="region" aria-label={`${group.name} task table`}><table><thead><tr>{config.columns.map(column=><th scope="col" key={column}>{fields.find(field=>field.id===column)?.name??"Unavailable field"}</th>)}</tr></thead><tbody>{rows.map(task=><tr key={task.id}>{config.columns.map(column=><td key={column}>{column==="title"?<button onClick={()=>onTask(task)}>{task.title}</button>:cell(task,column)||"—"}</td>)}</tr>)}</tbody></table></div>:rows.map(task=><article key={task.id} className={s.card} draggable={config.layout==="board"&&!pending} onDragStart={event=>event.dataTransfer.setData("text/teamspace-ticket",task.id)}><button onClick={()=>onTask(task)}>{task.title}</button>{config.columns.filter(column=>column!=="title").map(column=><p key={column}><strong>{fields.find(field=>field.id===column)?.name}:</strong> {cell(task,column)||"—"}</p>)}{config.layout==="board"&&<label>Move to {config.groupBy}<select disabled={Boolean(pending)} value={String(task[config.groupBy as "status"|"priority"]??"none")} onChange={event=>void move(task,event.target.value)}>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</article>)}
        </section>;
      })}</div>
      {cursor&&<button disabled={busy} onClick={async()=>{const sequence=++requestSequence.current;setBusy(true);setError("");try{const result=await reload(config,projectId,cursor);if(sequence===requestSequence.current){setTasks(previous=>[...previous,...result.tasks.filter(task=>!previous.some(item=>item.id===task.id))]);setCursor(result.nextCursor);}}catch(error){if(sequence===requestSequence.current)setError(error instanceof Error?error.message:"Next page could not be loaded.");}finally{if(sequence===requestSequence.current)setBusy(false);}}}>Load more tasks</button>}
      <button disabled={busy} onClick={()=>{let url:string|undefined;try{url=URL.createObjectURL(new Blob([JSON.stringify({config,projectId,tasks:shown,moreAvailable:Boolean(cursor)},null,2)],{type:"application/json"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="teamspace-view.json";document.body.append(anchor);anchor.click();anchor.remove();const saved=url;setTimeout(()=>URL.revokeObjectURL(saved),1000);}catch{if(url)URL.revokeObjectURL(url);setError("Export failed.");}}}>Download loaded results JSON</button>
    </>}
    {notice&&<p role="alert">{notice}</p>}
    {error&&<p className={s.error} role="alert">{error}</p>}
  </section>;
}
