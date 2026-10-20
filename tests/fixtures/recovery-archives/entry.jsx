import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import RecoveryArchives from "../../../src/app/components/RecoveryArchives";
import { indexedRecoveryStore } from "../../../src/lib/collaboration-store";
import { initializeDocument, encodeDocument } from "../../../src/lib/collaboration-model";

// Synthetic records on this fixture's dedicated origin; all storage/decoding is real.
const scopes = {
  page: "fixture-user:fixture-workspace:page:active",
  source: "fixture-user:fixture-workspace:source:active",
  account: "other-user:fixture-workspace:page:active",
  workspace: "fixture-user:other-workspace:page:active",
};
function record(text) {
  const doc = initializeDocument({ blocks: [{ type: "paragraph", text }] });
  try {
    return { version: 1, generation: crypto.randomUUID(), state: encodeDocument(doc), sequence: 0,
      pending: [{ operationId: crypto.randomUUID(), update: "AAA=", sent: false }] };
  } finally { doc.destroy(); }
}
async function addArchive(scope, text) {
  const store = indexedRecoveryStore(scope.replace(/:active$/, ":seed"));
  const value = record(text);
  await store.save(value);
  await store.archiveGeneration(value.generation);
}
function App() {
  const [selected, setSelected] = useState("page");
  const [status, setStatus] = useState("Seed synthetic archives to begin.");
  const [busy, setBusy] = useState(false);
  async function act(action) {
    setBusy(true);
    try { setStatus(await action()); }
    catch (error) { setStatus(`Fixture failure: ${error.message}`); }
    finally { setBusy(false); }
  }
  return <main>
    <h1>Recovery archive browser fixture</h1>
    <p>Real React Strict Mode, IndexedDB, Yjs and downloads. Synthetic device-local data only. No backend.</p>
    <button disabled={busy} onClick={() => void act(async () => {
      const active = record("ACTIVE JOURNAL MUST REMAIN UNCHANGED");
      await indexedRecoveryStore(scopes.page).save(active);
      sessionStorage.setItem("archive-fixture-active", JSON.stringify(active));
      for (let i = 1; i <= 25; i++) await addArchive(scopes.page, `Archived page content ${i}: café 🐈`);
      for (const key of ["source", "account", "workspace"]) await addArchive(scopes[key], `Isolated ${key} content`);
      return "Added 25 page archives, one source/account/workspace archive each, and an active journal. Seeding again appends.";
    })}>Seed archives</button>
    <button disabled={busy} onClick={() => void act(async () => {
      await addArchive(scopes.page, "NEW ARCHIVE FROM ANOTHER TAB");
      return "Added a newer page archive. Refresh the archive dialog in the other tab.";
    })}>Add newer archive</button>
    <button disabled={busy} onClick={() => void act(async () => {
      await indexedRecoveryStore("fixture-user:fixture-workspace:page:corrupt").save({
        ...record("Corrupt fixture"), archived: true, archivedAt: Date.now() + 1000, state: "invalid-checkpoint",
      });
      return "Added corrupt newest archive; older valid archives remain available.";
    })}>Add corrupt archive</button>
    <button disabled={busy} onClick={() => void act(async () => {
      const actual = await indexedRecoveryStore(scopes.page).load();
      return JSON.stringify(actual) === sessionStorage.getItem("archive-fixture-active")
        ? "PASS: active journal unchanged." : "FAIL: active journal differs or this tab did not seed it.";
    })}>Verify active journal</button>
    <label>Fixture scope <select value={selected} onChange={event => setSelected(event.target.value)}>
      {Object.keys(scopes).map(key => <option key={key}>{key}</option>)}
    </select></label>
    <output aria-live="polite">{status}</output>
    <RecoveryArchives key={selected} scope={scopes[selected]} title={`Fixture ${selected}`} />
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
