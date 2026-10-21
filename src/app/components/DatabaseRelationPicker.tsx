"use client";

import { useId, useState } from "react";
import type { DatabaseEntry } from "@/lib/databases";
import { changeDatabaseRelation, databaseRelationChoices } from "@/lib/database-relations";
import s from "./Databases.module.css";

export default function DatabaseRelationPicker({ name, targetName, entries, selected, disabled, targetArchived, error, retry, onChange }: {
  name: string; targetName: string; entries?: DatabaseEntry[]; selected: string[];
  disabled: boolean; targetArchived: boolean; error: string; retry: () => void; onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const statusId = useId();
  const loading = !entries && !error;
  const choices = databaseRelationChoices(entries ?? [], selected, search, targetArchived);
  return <span className={s.relationPicker}>
    <input type="search" aria-label={`Search ${name} entries`} aria-describedby={statusId} placeholder={`Search ${targetName}`} value={search} onChange={event => setSearch(event.target.value)} />
    <span id={statusId} className={s.muted} role="status">{selected.length} of 50 linked{loading ? " · Loading entries…" : ""}{targetArchived ? " · Target database archived" : ""}</span>
    {error && <span role="alert">{error} <button type="button" onClick={retry}>Retry loading entries</button></span>}
    <span className={s.choices}>
      {choices.map(choice => <label key={choice.id}><input type="checkbox" disabled={disabled || choice.disabled || (!choice.selected && (loading || Boolean(error)))} checked={choice.selected} onChange={event => { if (!disabled) onChange(changeDatabaseRelation(selected, choice, event.target.checked)); }} />
        <span>{choice.unavailable && loading ? `Loading entry (${choice.id})` : choice.title}{choice.archived ? " (archived)" : ""}</span>
      </label>)}
      {!loading && !error && !choices.length && <span className={s.muted}>{search.trim() ? "No matching entries." : "No entries available."}</span>}
    </span>
    <span><button type="button" disabled={disabled || !selected.length} onClick={() => { if (!disabled) onChange([]); }}>Clear links</button> <small>Link entries from {targetName}. Selected links stay visible while searching.</small></span>
  </span>;
}
