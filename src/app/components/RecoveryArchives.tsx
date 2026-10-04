"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { indexedRecoveryStore, type ArchiveCursor, type RecoveryArchive } from "@/lib/collaboration-store";
import { exportNoteMarkdown } from "@/lib/note-export";
import s from "./RecoveryArchives.module.css";

export default function RecoveryArchives({ scope, title }: { scope: string; title: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={s.trigger} onClick={() => setOpen(true)}>Local recovery archives</button>
    {open && <ArchiveBrowser scope={scope} title={title} close={() => setOpen(false)} />}
  </>;
}
function ArchiveBrowser({ scope, title, close }: { scope: string; title: string; close: () => void }) {
  const [store] = useState(() => indexedRecoveryStore(scope));
  const [rows, setRows] = useState<RecoveryArchive[]>([]);
  const [next, setNext] = useState<ArchiveCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false), running = useRef(false);
  const load = useCallback(async (cursor?: ArchiveCursor) => {
    if (running.current) return;
    running.current = true;
    try {
      const page = await store.listArchives!(cursor);
      if (!alive.current) return;
      setRows(previous => cursor ? [...previous, ...page.archives.filter(item => !previous.some(row => row.id === item.id))] : page.archives);
      setNext(page.next); setLoaded(true); setError("");
    } catch (error) { if (alive.current) setError((error as Error).message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }, [store]);
  useEffect(() => {
    const element = dialog.current, prior = document.activeElement as HTMLElement | null;
    alive.current = true; element?.showModal(); element?.querySelector<HTMLButtonElement>("button")?.focus();
    queueMicrotask(() => { if (alive.current) void load(); });
    return () => { alive.current = false; element?.close(); if (prior?.isConnected) prior.focus(); };
  }, [load]);
  async function download(row: RecoveryArchive) {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    let url: string | undefined;
    try {
      const content = await store.readArchive!(row.id);
      if (!alive.current) return;
      const stamp = row.archivedAt ? new Date(row.archivedAt).toISOString() : "unknown date";
      const exported = exportNoteMarkdown(`${title} — local recovery ${stamp}`, content);
      url = URL.createObjectURL(new Blob([exported.markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = exported.filename;
      try { document.body.append(anchor); anchor.click(); } finally { anchor.remove(); }
    } catch (error) { if (alive.current) setError(`Download failed: ${(error as Error).message} Keep this browser's data and retry.`); }
    finally {
      if (url) { const captured = url; setTimeout(() => URL.revokeObjectURL(captured), 1000); }
      running.current = false; if (alive.current) setBusy(false);
    }
  }
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="recovery-archive-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id="recovery-archive-title">Local recovery archives</h2><button type="button" onClick={close}>Close</button></header>
    <p>Archived edits for this page and account, on this device. Downloads contain the archived content; the current page title labels the file. These copies are separate from server history and are never replayed into live edits. Clearing browser data removes them.</p>
    <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(""); void load(); }}>Refresh archives</button>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {busy && <p role="status">Reading local recovery…</p>}
    {loaded && !rows.length && <p>No local recovery archives for this page.</p>}
    <ol>{rows.map((row, index) => <li key={row.id}>
      <div><strong>{row.archivedAt ? <time dateTime={new Date(row.archivedAt).toISOString()}>{new Date(row.archivedAt).toLocaleString()}</time> : "Unknown archive date"}</strong>
        <small>Archive {index + 1} · Generation {row.generation.slice(0, 8)} · {row.pendingCount} pending {row.pendingCount === 1 ? "update" : "updates"} when archived</small></div>
      <button type="button" disabled={busy} onClick={() => void download(row)}>Download Markdown</button>
    </li>)}</ol>
    {next && <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(""); void load(next); }}>Load older archives</button>}
  </dialog>;
}
