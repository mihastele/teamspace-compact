"use client";
import type { BoardProperty, Member, Project } from "@/lib/model";
import { builtinFields, queryFieldType, queryOperators, type Filter } from "@/lib/ticket-query";
import s from "./TicketViews.module.css";

const names: Record<string,string> = {title:"Task",description:"Description",status:"Status",priority:"Priority",assigneeId:"Assignee",projectId:"Project",dueDate:"Due date",estimate:"Estimate",position:"Board order"};
const operators:Record<string,string>={eq:"Equals",neq:"Does not equal",contains:"Contains",notContains:"Does not contain",isEmpty:"Is empty",isNotEmpty:"Is not empty",in:"Is one of",notIn:"Is not one of",containsAny:"Contains any",containsAll:"Contains all",before:"Before",after:"After",between:"Between (inclusive)",gt:"Greater than",lt:"Less than"};
export function queryFields(properties:BoardProperty[],projects:Project[]){return [...Object.keys(builtinFields).map(id=>({id,name:names[id]})),...properties.map(property=>({id:`custom:${property.id}`,name:`${property.name}${property.projectId?` (${projects.find(project=>project.id===property.projectId)?.name??"Project"})`:""}`}))];}
export default function TicketFilters({filter,onChange,properties,members,projects,depth=0}: {filter:Filter;onChange:(filter:Filter)=>void;properties:BoardProperty[];members:Member[];projects:Project[];depth?:number}) {
  const choices=queryFields(properties,projects);
  if("and" in filter || "or" in filter){
    const mode="and" in filter?"and":"or",children="and" in filter?filter.and:filter.or;
    return <fieldset className={s.group}><legend>Filter group</legend>
      <label>Match<select aria-label="Filter group match" value={mode} onChange={event=>onChange({[event.target.value]:children} as Filter)}><option value="and">All conditions (AND)</option><option value="or">Any condition (OR)</option></select></label>
      {children.map((child,index)=><div key={index} className={s.condition}><TicketFilters filter={child} depth={depth+1} properties={properties} members={members} projects={projects} onChange={next=>onChange({[mode]:children.map((item,i)=>i===index?next:item)} as Filter)}/><button type="button" onClick={()=>onChange({[mode]:children.filter((_,i)=>i!==index)} as Filter)}>Remove condition {index+1}</button></div>)}
      <button type="button" disabled={depth>=4||children.length>=16} onClick={()=>onChange({[mode]:[...children,{field:"status",op:"eq",value:"todo"}]} as Filter)}>+ Condition</button>{" "}
      <button type="button" disabled={depth>=3||children.length>=16} onClick={()=>onChange({[mode]:[...children,{and:[]}]} as Filter)}>+ Nested group</button>
      {!children.length&&<p>{mode==="and"?"No conditions: matches every task.":"No conditions: matches no tasks."}</p>}
    </fieldset>;
  }
  let type:string;try{type=queryFieldType(filter.field,properties);}catch{type="text";}
  const property=properties.find(property=>`custom:${property.id}`===filter.field);
  const options=type==="status"?[{id:"todo",name:"To do"},{id:"doing",name:"In progress"},{id:"done",name:"Done"}]:type==="priority"?["none","low","medium","high","urgent"].map(id=>({id,name:id})):type==="person"?[{id:"@me",name:"Me"},...members.map(member=>({id:member.id,name:member.displayName}))]:type==="relation"?[...(filter.field==="projectId"?[{id:"@project",name:"Selected Project"}]:[]),...projects.map(project=>({id:project.id,name:project.name+(project.archived?" (archived)":"")}))]:property?.options.map(option=>({id:option.id,name:option.name+(option.archived?" (archived)":"")}));
  const multiple=["in","notIn","containsAny","containsAll"].includes(filter.op);
  return <div className={s.filterRow}>
    <label>Field<select value={filter.field} onChange={event=>onChange({field:event.target.value,op:"isNotEmpty"})}>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
    <label>Operator<select value={filter.op} onChange={event=>{const op=event.target.value;onChange({field:filter.field,op,...(["isEmpty","isNotEmpty"].includes(op)?{}:{value:op==="between"?["@today","@today+7"]:["in","notIn","containsAny","containsAll"].includes(op)?[]:type==="checkbox"?true:options?.[0]?.id??(type==="number"?0:"")})});}}>{queryOperators(type).map(op=><option key={op} value={op}>{operators[op]}</option>)}</select></label>
    {!["isEmpty","isNotEmpty"].includes(filter.op)&&(options?<label>Value<select multiple={multiple} value={multiple?Array.isArray(filter.value)?filter.value as string[]:[]:typeof filter.value==="string"?filter.value:""} onChange={event=>onChange({...filter,value:multiple?Array.from(event.target.selectedOptions,option=>option.value):event.target.value})}>{options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select>{multiple&&<small>Choose one or more values.</small>}</label>:type==="checkbox"?<label>Value<select value={String(filter.value)} onChange={event=>onChange({...filter,value:event.target.value==="true"})}><option value="true">Checked</option><option value="false">Unchecked</option></select></label>:filter.op==="between"?<>{[0,1].map(index=><label key={index}>{index?"Through":"From"}<input value={Array.isArray(filter.value)?String(filter.value[index]??""):""} onChange={event=>{const values=Array.isArray(filter.value)?[...filter.value]:["",""];values[index]=event.target.value;onChange({...filter,value:values});}}/></label>)}</>:<label>Value<input type={type==="number"?"number":"text"} step="any" maxLength={2000} value={typeof filter.value==="string"||typeof filter.value==="number"?filter.value:""} onChange={event=>onChange({...filter,value:type==="number"?event.target.valueAsNumber:event.target.value})}/>{type==="date"&&<small>YYYY-MM-DD, @today, or @today+7 / @today-7</small>}</label>)}
    <button type="button" disabled={depth>=3} onClick={()=>onChange({and:[filter]})}>Combine with more conditions</button>
  </div>;
}
