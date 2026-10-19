import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import TicketViews, { SavedViewLink } from "../../../src/app/components/TicketViews";
import { newNamedBoard } from "../../../src/lib/named-board";

// Deliberately synthetic: only the component contract exercised by the checklist.
let rows = [{ ...newNamedBoard(), id: "engineering", name: "Engineering", revision: 1, archived: false }];
const receipts = new Map();
let writes = 0, lose = false;
const relationId = "00000000-0000-4000-8000-000000000001";
const sizeId = "00000000-0000-4000-8000-000000000002";
const properties = [
  { id: relationId, name: "Related Project", type: "relation", revision: 1, options: [] },
  { id: sizeId, name: "Size", type: "number", revision: 1, options: [] },
];
const tasks = [
  { id: "a", title: "Design homepage", status: "todo", priority: "high", projectId: "p1", position: 1, revision: 1, customValues: { [relationId]: "p1", [sizeId]: "3" } },
  { id: "b", title: "Ship release", status: "doing", priority: "medium", projectId: "p2", position: 2, revision: 1, customValues: { [relationId]: "p2", [sizeId]: "8" } },
];
function matches(task, filter) {
  if (filter.and) return filter.and.every(item => matches(task, item));
  if (filter.or) return filter.or.some(item => matches(task, item));
  const value = filter.field.startsWith("custom:") ? task.customValues[filter.field.slice(7)] : task[filter.field];
  switch (filter.op) {
    case "isNotEmpty": return value != null;
    case "isEmpty": return value == null;
    case "eq": return value === filter.value;
    case "neq": return value !== filter.value;
    case "in": return filter.value.includes(value);
    default: throw new Error("This synthetic fixture does not implement that filter operator. Use the real PostgreSQL query tests.");
  }
}
const unsupported = async () => { throw new Error("Task mutations and default seeding are outside this fixture."); };

function App() {
  const [links, setLinks] = useState([undefined, undefined]);
  const [snapshot, setSnapshot] = useState(rows);
  const [disabled, setDisabled] = useState(false);
  const [count, setCount] = useState(0);
  const listViews = useCallback(async () => structuredClone(rows), []);
  const queryTickets = useCallback(async query => ({ tasks: tasks.filter(task => matches(task, query.filter)), nextCursor: null }), []);
  const saveView = useCallback(async (config, controls) => {
    let saved;
    if (controls.operationId) {
      const receipt = receipts.get(controls.operationId);
      const digest = JSON.stringify(config);
      if (receipt && receipt.digest !== digest) throw new Error("Retry payload changed.");
      saved = receipt?.row;
      if (!saved) {
        saved = { ...structuredClone(config), id: crypto.randomUUID(), revision: 1, archived: false };
        rows = [...rows, saved];
        receipts.set(controls.operationId, { digest, row: saved });
        writes++;
      }
    } else {
      const old = rows.find(row => row.id === controls.id);
      if (!old || old.revision !== controls.expectedRevision) throw new Error("This view changed. Reopen it to review its latest settings.");
      saved = { ...old, ...structuredClone(config), revision: old.revision + 1 };
      rows = rows.map(row => row.id === saved.id ? saved : row);
      writes++;
    }
    setCount(writes);
    setSnapshot(structuredClone(rows));
    if (lose) { lose = false; throw new Error("Synthetic lost response"); }
    return structuredClone(saved);
  }, []);
  const api = {
    projectsEnabled: true, workspace: { id: "fixture" }, boardProperties: properties,
    members: [{ id: "me", displayName: "Tester" }], projects: [{ id: "p1", name: "Website" }, { id: "p2", name: "Mobile" }],
    tasks, savedViews: snapshot, listViews, queryTickets, saveView,
    setTaskStatus: unsupported, saveTask: unsupported, seedViews: unsupported,
  };
  return <main>
    <h1>Named board component acceptance fixture</h1>
    <p>In-memory mock API; no authenticated backend. Reload resets all fixture data.</p>
    <button onClick={() => { lose = true; }}>Lose next save response</button>
    <button onClick={() => { rows = rows.map(row => ({ ...row, name: row.name + " remote", revision: row.revision + 1 })); setSnapshot(structuredClone(rows)); }}>Remote rename</button>
    <button onClick={() => setDisabled(!disabled)}>Toggle note editing</button>
    <output>Saved writes: {count}; boards: {snapshot.length}</output>
    {links.map((view, index) => <section key={index} aria-label={"Board slot " + (index + 1)} style={{ border: "1px solid #ccd", padding: 16, marginTop: 16 }}>
      <h2>Board slot {index + 1}</h2>
      <SavedViewLink api={api} view={view} disabled={disabled} onApply={(next, baseline) => {
        if (JSON.stringify(baseline) !== JSON.stringify(links[index])) throw new Error("This linked view changed. Reopen settings.");
        setLinks(current => current.map((link, i) => i === index ? next : link));
      }} />
      {view?.savedViewId && <TicketViews key={view.savedViewId} api={api} viewId={view.savedViewId} disabled={disabled}
        onLink={id => setLinks(current => current.map((link, i) => i === index ? { ...link, savedViewId: id } : link))} onTask={() => {}} />}
    </section>)}
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
