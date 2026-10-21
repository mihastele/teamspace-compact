import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DatabaseRelationPicker from "../../../src/app/components/DatabaseRelationPicker";

const entries = Array.from({length:60},(_,i)=>({id:`entry-${i}`,title:i===0?"Čebelica Team":`Client ${i}`,archived:i===2}));
function App(){
  const [selected,setSelected]=useState(["entry-1","entry-2","missing"]);
  const [disabled,setDisabled]=useState(false);
  const [archived,setArchived]=useState(false);
  const [mode,setMode]=useState("ready");
  const [changes,setChanges]=useState(0);
  return <main><h1>Database relations component fixture</h1>
    <p>Synthetic targets only. No backend, drafts or saved workspace changes.</p>
    <div><button onClick={()=>{setSelected(["entry-1","entry-2","missing"]);setDisabled(false);setArchived(false);setMode("ready");setChanges(0);}}>Reset fixture</button>
    <button onClick={()=>setSelected(entries.slice(0,50).map(entry=>entry.id))}>Fill to limit</button>
    <label><input type="checkbox" checked={disabled} onChange={event=>setDisabled(event.target.checked)}/>Disable editing</label>
    <label><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/>Archive target database</label>
    <button onClick={()=>setMode("loading")}>Simulate loading</button><button onClick={()=>setMode("error")}>Simulate failure</button></div>
    <div style={{maxWidth:600,margin:"24px 0"}}><DatabaseRelationPicker name="Clients" targetName="Customers" entries={mode==="ready"?entries:undefined} selected={selected} disabled={disabled} targetArchived={archived} error={mode==="error"?"Could not load relation entries. Existing links are preserved.":""} retry={()=>setMode("ready")} onChange={ids=>{setSelected(ids);setChanges(value=>value+1);}}/></div>
    <output aria-label="Selected identities">{JSON.stringify(selected)}</output><output aria-label="Changes">{changes} selection changes</output>
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
