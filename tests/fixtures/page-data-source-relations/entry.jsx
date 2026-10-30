import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import EntityDatabaseRelations from "../../../src/app/components/EntityDatabaseRelations";
const database="11111111-1111-4111-8111-111111111111",field="22222222-2222-4222-8222-222222222222",entry="33333333-3333-4333-8333-333333333333";
let fields=[{id:field,name:"Meetings",scope:"task",targetDatabaseId:database,revision:1}];
const databases=[{id:database,name:"Meetings",archived:false,fields:[]}],entries=[{id:entry,title:"Kickoff",archived:false}];
async function request(path,method,body){
  if(path==="entityRelationFields")return {fields};
  if(path==="databases")return {databases};
  if(path===`databases/${database}?summary=1`)return {entries,nextCursor:null};
  if(path.startsWith('entityRelationFields/')&&method==='PUT'){const id=path.split('/')[1];fields=[...fields,{id,name:body.name,scope:body.scope,targetDatabaseId:body.targetDatabaseId,revision:1}];return {field:fields.at(-1)};}
  throw new Error(`Unexpected ${method} ${path}`);
}
const api={user:{uid:'fixture'},workspace:{id:'fixture'},databaseRequest:request};
function App(){const [scope,setScope]=useState('task'),[draft,setDraft]=useState({}),[saved,setSaved]=useState({});return <main><h1>Page data-source relations fixture</h1><p>Synthetic in-memory data only.</p><button onClick={()=>{setScope(scope==='task'?'project':'task');setDraft({});}}>Switch scope</button><EntityDatabaseRelations key={scope} api={api} scope={scope} values={draft} disabled={false} onChange={setDraft}/><button onClick={()=>setSaved(draft)}>Save page</button><output aria-label="Draft">{JSON.stringify(draft)}</output><output aria-label="Saved">{JSON.stringify(saved)}</output></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
