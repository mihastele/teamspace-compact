"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardProperty, PropertyValue, Task } from "@/lib/model";
import type { useTeamspace } from "@/lib/client";
import { MAX_PROPERTIES, propertyDisplay } from "@/lib/board-properties";
import s from "./BoardProperties.module.css";

type Api = ReturnType<typeof useTeamspace>;
const labels = { text: "Text", select: "Select", multiSelect: "Multi-select", date: "Date" };

function PropertyEditor({ api, initial, close }: { api: Api; initial?: BoardProperty; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<BoardProperty["type"]>(initial?.type ?? "text");
  const [options, setOptions] = useState(initial?.options ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (prior?.isConnected) prior.focus(); };
  }, []);
  const changed = name !== (initial?.name ?? "") || type !== (initial?.type ?? "text") || JSON.stringify(options) !== JSON.stringify(initial?.options ?? []);
  function attemptClose() {
    if (!busy && (!changed || confirm("Discard unsaved property changes?"))) close();
  }
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={`property-title-${id}`}
    onCancel={event => { event.preventDefault(); attemptClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError("");
      try { await api.saveBoardProperty({ id, name, type, options }, initial?.revision ?? 0); close(); }
      catch (error) { setError(error instanceof Error ? error.message : "Property could not be saved."); }
      finally { setBusy(false); }
    }}>
      <h2 id={`property-title-${id}`}>{initial ? "Edit property" : "Add property"}</h2>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label>Name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Priority, Release date" /></label>
        <label>Type<select value={type} disabled={Boolean(initial)} onChange={event => { setType(event.target.value as BoardProperty["type"]); setOptions([]); }}>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {(type === "select" || type === "multiSelect") && <div>
          <h3>Options</h3>
          {options.map((option, index) => <label key={option.id}>Option {index + 1}<input required maxLength={80} value={option.name}
            onChange={event => setOptions(previous => previous.map(item => item.id === option.id ? { ...item, name: event.target.value } : item))} /></label>)}
          <button type="button" disabled={options.length >= 50} onClick={() => setOptions(previous => [...previous, { id: crypto.randomUUID(), name: "" }])}>Add option</button>
        </div>}
      </fieldset>
      <p className={s.hint}>Names can change. Existing field types and options are retained to preserve task values. Custom dates are date-only; the calendar uses Due date.</p>
      <div className={s.actions}><button type="button" disabled={busy} onClick={attemptClose}>Cancel</button><button disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save property"}</button></div>
    </form>
  </dialog>;
}

export function BoardProperties({ api }: { api: Api }) {
  const [editing, setEditing] = useState<BoardProperty | "new" | null>(null);
  const [exportError, setExportError] = useState("");
  return <div className={s.manager}>
    <details><summary>Properties ({api.boardProperties.length})</summary>
      <div className={s.list}>
        {api.boardProperties.length === 0 && <p>Add fields such as Priority, Labels or Release date.</p>}
        {api.boardProperties.map(property => <button key={property.id} onClick={() => setEditing(property)}>{property.name} · {labels[property.type]}</button>)}
        <button disabled={api.boardProperties.length >= MAX_PROPERTIES} onClick={() => setEditing("new")}>+ Add property</button>
        <button onClick={() => {
          setExportError("");
          let url: string | undefined;
          try {
            url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, properties: api.boardProperties, tasks: api.tasks }, null, 2)], { type: "application/json" }));
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = "teamspace-board.json"; document.body.append(anchor); anchor.click(); anchor.remove();
            const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
          } catch { if (url) URL.revokeObjectURL(url); setExportError("Board export failed. Your data is unchanged."); }
        }}>Download board JSON</button>
        <p className={s.hint}>Exports all saved tasks and field definitions. Attachments and conversations are separate.</p>
        {exportError && <p role="alert">{exportError}</p>}
      </div>
    </details>
    {editing && <PropertyEditor key={editing === "new" ? "new" : editing.id} api={api} initial={editing === "new" ? undefined : editing} close={() => setEditing(null)} />}
  </div>;
}

export function TaskPropertyInputs({ properties, values, onChange, disabled }: {
  properties: BoardProperty[]; values: Record<string, PropertyValue>;
  onChange: (id: string, value: PropertyValue) => void; disabled: boolean;
}) {
  return <fieldset className={s.values} disabled={disabled}>
    {properties.length > 0 && <legend>Custom properties</legend>}
    {properties.map(property => {
      const value = values[property.id];
      if (property.type === "multiSelect") return <fieldset key={property.id} className={s.options}><legend>{property.name}</legend>
        {property.options.length === 0 && <p>No options yet. Add options from Board → Properties.</p>}
        {property.options.map(option => <label key={option.id}><input type="checkbox" checked={Array.isArray(value) && value.includes(option.id)} onChange={event => {
          const selected = Array.isArray(value) ? value : [];
          onChange(property.id, event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id));
        }} />{option.name}</label>)}
      </fieldset>;
      return <label key={property.id}>{property.name}
        {property.type === "select" ? <select value={typeof value === "string" ? value : ""} onChange={event => onChange(property.id, event.target.value || null)}>
          <option value="">No selection</option>{property.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select> : <input type={property.type === "date" ? "date" : "text"} maxLength={2000} value={typeof value === "string" ? value : ""} onChange={event => onChange(property.id, event.target.value || null)} />}
      </label>;
    })}
  </fieldset>;
}

export function TaskPropertySummary({ task, properties }: { task: Task; properties: BoardProperty[] }) {
  const values = properties.map(property => ({ property, text: propertyDisplay(property, task.propertyValues?.[property.id]) })).filter(item => item.text);
  return values.length ? <span className={s.summary}>{values.map(({ property, text }) => <span key={property.id}><strong>{property.name}:</strong> {text}</span>)}</span> : null;
}
