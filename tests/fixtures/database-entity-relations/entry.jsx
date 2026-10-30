import React from "react";
import { createRoot } from "react-dom/client";
import Databases from "../../../src/app/components/Databases";

const id="11111111-1111-4111-8111-111111111111", entry="22222222-2222-4222-8222-222222222222";
const taskField="33333333-3333-4333-8333-333333333333", projectField="44444444-4444-4444-8444-444444444444";
const definition={id,name:"Work",description:"Fixture",archived:false,revision:1,fields:[
  {id:taskField,name:"Tasks",type:"relation",targetKind:"task",options:[],revision:1},
  {id:projectField,name:"Projects",type:"relation",targetKind:"project",options:[],revision:1},
]};
let rows=[{id:entry,databaseId:id,title:"Entry",content:{blocks:[]},propertyValues:{[taskField]:["task-one"],[projectField]:["project-one"]},archived:false,revision:1}];
async function request(path,method,body){
  if(path==="databases")return {databases:[definition]};
  if(path===`databases/${id}`)return {database:definition,entries:rows,nextCursor:null,truncated:false};
  if(path===`databaseEntries/${entry}`&&method==="GET")return {entry:rows[0],incoming:[],truncated:false};
  if(path===`databaseEntries/${entry}`&&method==="PUT"){rows=[{...rows[0],...body,revision:rows[0].revision+1}];return {entry:rows[0]};}
  throw new Error(`Unexpected fixture request: ${method} ${path}`);
}
const api={user:{uid:"fixture"},workspace:{id:"fixture"},members:[],databaseRequest:request,
  tasks:[{id:"task-one",title:"Task One",revision:1},{id:"task-two",title:"Task Two",revision:1}],
  projects:[{id:"project-one",name:"Project One",archived:false,revision:1},{id:"project-old",name:"Old Project",archived:true,revision:1}]};
function App(){return <main><h1>Task and project relation fixture</h1><p>Synthetic in-memory data only.</p><Databases api={api} onTask={task=>document.querySelector('output').textContent=`Task: ${task.title}`} onProject={id=>document.querySelector('output').textContent=`Project: ${id}`}/><output aria-label="Opened target"/></main>}
createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
