"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { useTeamspace } from "@/lib/client";
import { useCollaborativeNote } from "@/lib/use-collaborative-note";
import type { BlockSource, NoteBlock, NoteContent } from "@/lib/model";
import { detachLinkedBlock, editLinkedSource, linkedSourceIds, linkableTypes, mergePreviewLinkedEdit, sourceBlock } from "@/lib/linked-content";
import { exportNoteMarkdown } from "@/lib/note-export";
import MarkdownText from "./MarkdownText";
import s from "./LinkedContent.module.css";

type Api = ReturnType<typeof useTeamspace>;
type Collaboration = ReturnType<typeof useCollaborativeNote>;
type SourceHandle = Pick<Collaboration, "content" | "pending" | "ready" | "readOnly" | "error" | "generationChanged"> & {
  status: string;
  undo?: () => void;
  redo?: () => void;
  change: (next: NoteContent, base: NoteContent, requiredBlockId?: string) => void | Promise<void>;
};
type LinkedDraft = { text: string; base: NoteContent; composing: boolean; failed: boolean };
const Scope = createContext<{ api: Api; sources: Record<string, SourceHandle>; onOpen: (id: string) => void; risk: (id: string, value: boolean) => void; risks: Record<string, boolean>; preserve: (id: string, draft: LinkedDraft | null) => void; drafts: Record<string, LinkedDraft> } | null>(null);
export function useSyncedBlockGuard() {
  const scope = useContext(Scope);
  return (block: NoteBlock) => block.type === "synced" && Boolean(scope?.risks[`block:${block.id ?? `${block.source?.noteId}:${block.source?.blockId}`}`] || (block.source && scope?.sources[block.source.noteId]?.pending));
}
function download(title: string, content: NoteContent) {
  const exported = exportNoteMarkdown(title, content);
  const url = URL.createObjectURL(new Blob([exported.markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = exported.filename;
  try { document.body.append(link); link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function SyncedContentScope({ api, noteId, content, main, onChangeMain, onOpen, onRiskChange, children }: {
  api: Api; noteId: string | null; content: NoteContent; main: Collaboration | null;
  onChangeMain: (next: NoteContent, base?: NoteContent) => void; onOpen: (id: string) => void;
  onRiskChange: (risk: boolean) => void; children: ReactNode;
}) {
  const requested = linkedSourceIds(content).filter(id => id !== noteId);
  const [visited, setVisited] = useState(requested);
  const additions = requested.filter(id => !visited.includes(id));
  if (additions.length) setVisited([...visited, ...additions]);
  const [views, setViews] = useState<Record<string, Collaboration>>({});
  const [risks, setRisks] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, LinkedDraft>>({});
  const publish = useCallback((id: string, view: Collaboration) => setViews(previous => previous[id] === view ? previous : { ...previous, [id]: view }), []);
  const risk = useCallback((id: string, value: boolean) => setRisks(previous => previous[id] === value ? previous : { ...previous, [id]: value }), []);
  const preserve = useCallback((id: string, draft: LinkedDraft | null) => setDrafts(previous => {
    if (previous[id] === draft || (!draft && !previous[id])) return previous;
    const next = { ...previous }; if (draft) next[id] = draft; else delete next[id]; return next;
  }), []);
  const pending = Object.values(views).some(view => view.pending) || Object.values(risks).some(Boolean) || Object.keys(drafts).length > 0;
  useEffect(() => { onRiskChange(pending); }, [pending, onRiskChange]);
  useEffect(() => () => onRiskChange(false), [onRiskChange]);
  const sources: Record<string, SourceHandle> = {};
  for (const id of visited) {
    if (api.configured) {
      if (views[id]) sources[id] = { ...views[id], change: views[id].changeChecked };
    } else {
      const note = api.notes.find(note => note.id === id);
      if (note) sources[id] = { content: note.content, ready: true, readOnly: false, pending: false, error: null, generationChanged: false, status: "Saved locally",
        change: async next => { await api.saveNote({ id, title: note.title, parentId: note.parentId, content: next, expectedRevision: note.revision }); } };
    }
  }
  if (noteId) sources[noteId] = main ? { ...main, content, change: main.changeChecked } : { content, ready: true, readOnly: false, pending: false, error: null, generationChanged: false, status: "Saved with this note", change: (next, base, requiredBlockId) => {
    if (!requiredBlockId) { onChangeMain(next, base); return; }
    onChangeMain(mergePreviewLinkedEdit(content, base, next, { noteId, blockId: requiredBlockId }), content);
  } };
  const liveKeys = new Set(content.blocks.filter(block => block.type === "synced").map(block => `block:${block.id ?? `${block.source?.noteId}:${block.source?.blockId}`}`));
  return <Scope.Provider value={{ api, sources, onOpen, risk, risks, preserve, drafts }}>
    {api.configured && visited.map(id => <SourceBridge key={id} api={api} id={id} publish={publish} />)}
    {children}
    {Object.entries(drafts).filter(([id]) => !liveKeys.has(id)).map(([id, draft]) => <div key={id} className={s.synced}>
      <p role="alert">A linked block was removed while it had unfinished edits. Your draft is preserved here.</p>
      <textarea aria-label="Draft from removed linked block" readOnly value={draft.text} />
      <button type="button" onClick={() => download("Removed linked block draft", { blocks: [{ type: "paragraph", text: draft.text }] })}>Download preserved draft</button>
      <button type="button" onClick={() => { if (confirm("Discard the preserved draft from the removed linked block?")) preserve(id, null); }}>Discard preserved draft</button>
    </div>)}
  </Scope.Provider>;
}
function SourceBridge({ api, id, publish }: { api: Api; id: string; publish: (id: string, view: Collaboration) => void }) {
  const view = useCollaborativeNote({ api, noteId: id, enabled: api.configured });
  const [exportError, setExportError] = useState("");
  useEffect(() => { publish(id, view); }, [id, view, publish]);
  const title = api.notes.find(note => note.id === id)?.title || "Unavailable source note";
  const recovery = view.recoveryContent ?? view.content;
  return view.error || view.pending || view.archivedRecoveryContent || view.archivedRecoveryError ? <div className={s.synced}>
    <p role={view.error ? "alert" : "status"}>Linked edits in {title}: {view.status}{view.error ? ` · ${view.error}` : ""}</p>
    {view.error && <button type="button" onClick={view.retry}>Retry linked edits</button>}
    {recovery && <button type="button" onClick={() => { try { download(`${title} — linked recovery`, recovery); setExportError(""); } catch { setExportError("Recovery download failed. Keep this browser open and try again."); } }}>Download source recovery</button>}
    {view.generationChanged && view.pending && <button type="button" onClick={() => { if (confirm("Keep pending linked edits in local recovery and reload the restored source?")) void view.discardRecoveryAndRetry(); }}>Keep recovery locally &amp; reload source</button>}
    {view.archivedRecoveryContent && <button type="button" onClick={() => { try { download(`${title} — archived linked recovery`, view.archivedRecoveryContent!); } catch { setExportError("Recovery download failed. Keep browser storage and try again."); } }}>Download archived source recovery</button>}
    {exportError && <p role="alert">{exportError}</p>}
    {view.archivedRecoveryError && <p role="alert">{view.archivedRecoveryError}</p>}
  </div> : null;
}

export function SyncedBlock({ block, disabled, onDetach }: { block: NoteBlock; disabled: boolean; onDetach: (replacement: NoteBlock) => void }) {
  const scope = useContext(Scope);
  const source = block.source;
  const handle = source ? scope?.sources[source.noteId] : undefined;
  const original = source && sourceBlock(handle?.content, source);
  const sourceExists = source && scope?.api.notes.some(note => note.id === source.noteId);
  const riskKey = `block:${block.id ?? `${source?.noteId}:${source?.blockId}`}`;
  const [buffer, setBuffer] = useState<LinkedDraft | null>(() => {
    const retained = scope?.drafts[riskKey]; return retained ? { ...retained, composing: false, failed: true } : null;
  });
  const bufferRef = useRef(buffer);
  const completedComposition = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const risk = scope?.risk;
  const preserve = scope?.preserve;
  useEffect(() => { bufferRef.current = buffer; }, [buffer]);
  useEffect(() => { risk?.(riskKey, Boolean(buffer || saving)); }, [risk, riskKey, buffer, saving]);
  useEffect(() => () => risk?.(riskKey, false), [risk, riskKey]);
  function keepBuffer(next: LinkedDraft | null) { bufferRef.current = next; setBuffer(next); preserve?.(riskKey, next); }
  const writable = !disabled && Boolean(original && sourceExists && handle?.ready && !handle.readOnly && !saving && !buffer?.failed);
  async function change(text: string, base = handle?.content) {
    if (!source || !handle || !base || !original || !sourceExists || handle.readOnly || disabled) {
      if (base) keepBuffer({ text, base, composing: false, failed: true });
      setError("The source is unavailable for editing. Your text is kept here; copy or download it."); return;
    }
    // The configured controller persists before sending; local preview uses revision-checked Save.
    try {
      const intent = editLinkedSource(base, source, { text });
      const operation = handle.change(intent, base, source.blockId);
      if (operation instanceof Promise) { keepBuffer({ text, base, composing: false, failed: false }); setSaving(true); await operation; }
      keepBuffer(null); setError("");
    } catch (error) { keepBuffer({ text, base, composing: false, failed: true }); setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <div className={s.synced} data-synced-editor="true">
    <div className={s.sourceHeader}>
      <strong>Synced block</strong><span>{scope?.api.notes.find(note => note.id === source?.noteId)?.title || "Unavailable source"}</span>
      {sourceExists && <button type="button" onClick={() => scope?.onOpen(source!.noteId)}>Open original</button>}
      {original && <button type="button" disabled={disabled || Boolean(buffer) || saving || handle?.pending} onClick={() => onDetach(detachLinkedBlock(block, original))}>Make independent</button>}
    </div>
    {(!original || !sourceExists) && <p role="status">The original block was deleted, changed to an unsupported type, or is unavailable. This link is preserved.</p>}
    {original && sourceExists && <>
      {original.type === "todo" && <label><input type="checkbox" checked={original.checked ?? false} disabled={!writable} onChange={event => {
        if (!handle?.content || !source) return;
        const base = handle.content;
        try {
          const operation = handle.change(editLinkedSource(base, source, { checked: event.target.checked }), base, source.blockId);
          if (operation instanceof Promise) { setSaving(true); void operation.catch(error => setError((error as Error).message)).finally(() => setSaving(false)); }
        } catch(error) { setError((error as Error).message); }
      }} />Completed</label>}
      <label>{original.type === "heading" ? `Heading ${original.level ?? 1}` : original.type} · {handle?.status}</label>
      <textarea aria-label={`Synced content from ${scope?.api.notes.find(note=>note.id===source?.noteId)?.title || "source note"}`} maxLength={20000}
        onKeyDown={event => {
          if (!handle?.undo || event.nativeEvent.isComposing || (!event.ctrlKey && !event.metaKey)) return;
          const key = event.key.toLowerCase();
          if (key !== "z" && !(key === "y" && !event.metaKey)) return;
          event.preventDefault(); event.stopPropagation();
          if (buffer || !writable) return;
          if (key === "y" || event.shiftKey) handle.redo?.(); else handle.undo();
        }}
        value={buffer?.text ?? original.text} readOnly={!writable} onChange={event => {
          if (completedComposition.current === event.target.value) { completedComposition.current = null; return; }
          completedComposition.current = null;
          const buffered = bufferRef.current;
          if (buffered?.composing) { keepBuffer({...buffered,text:event.target.value}); }
          else void change(event.target.value);
        }} onCompositionStart={() => {
          if (!handle?.content || !writable) return;
          completedComposition.current = null;
          keepBuffer({ text: original.text, base: handle.content, composing: true, failed: false });
        }} onCompositionEnd={event => {
          const captured = bufferRef.current; bufferRef.current = null;
          completedComposition.current = event.currentTarget.value;
          if (captured) void change(event.currentTarget.value, captured.base);
        }} />
      <MarkdownText text={original.text} />
    </>}
    {buffer && (!original || !sourceExists || buffer.failed) && <><label>Preserved linked draft<textarea aria-label="Preserved linked draft" readOnly value={buffer.text} /></label>
      <button type="button" onClick={() => { try { download("Linked block draft", { blocks:[{type:"paragraph",text:buffer.text}] }); } catch { setError("Download failed. Select and copy the preserved text."); } }}>Download preserved draft</button>
      <button type="button" onClick={() => { if (confirm("Discard this preserved text and show the latest source?")) { keepBuffer(null); setError(""); } }}>Discard preserved draft</button></>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function SyncedSourcePicker({ api, onChoose, close }: { api: Api; onChoose: (source: BlockSource) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(api.notes[0]?.id ?? "");
  const [prepared, setPrepared] = useState<NoteContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = api.notes.find(note => note.id === selected);
  const content = prepared ?? saved?.content;
  useEffect(() => {
    const element=dialog.current, prior=document.activeElement as HTMLElement | null;
    element?.showModal(); element?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {element?.close(); if(prior?.isConnected)prior.focus();};
  }, []);
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="synced-picker-title" onCancel={event=>{event.preventDefault(); if(!busy)close();}}>
    <h2 id="synced-picker-title">Link a saved content block</h2>
    <p>Edits change the original block and all its linked copies. Sources belong to this workspace. Boards, dividers and other linked blocks cannot be sources.</p>
    {error && <p role="alert">{error}</p>}
    <label>Source note<select value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setPrepared(null);setError("");}}>
      {!api.notes.length && <option value="">Save a note first</option>}
      {api.notes.map(note=><option key={note.id} value={note.id}>{note.title || "Untitled note"}</option>)}
    </select></label>
    {content?.blocks.some(block=>linkableTypes.has(block.type)&&!block.id) && <button type="button" disabled={busy || !saved} onClick={async()=>{
      if(!saved)return;setBusy(true);setError("");
      try { const note=api.configured ? await api.initializeCollaboration(saved.id) : await api.saveNote({id:saved.id,title:saved.title,parentId:saved.parentId,content:saved.content,expectedRevision:saved.revision});setPrepared(note.content); }
      catch(error){setError((error as Error).message);}finally{setBusy(false);}
    }}>Prepare stable source blocks</button>}
    <div className={s.pickerOptions}>
      {content?.blocks.filter(block=>block.id&&linkableTypes.has(block.type)).map(block=><button key={block.id} type="button" disabled={busy} onClick={()=>{
        try {onChoose({noteId:selected,blockId:block.id!});close();}catch(error){setError((error as Error).message);}
      }}><strong>{block.type === "heading" ? `Heading ${block.level??1}` : block.type}</strong><span>{block.text.slice(0,160)||"Empty block"}</span></button>)}
      {content && !content.blocks.some(block=>linkableTypes.has(block.type)) && <p>This note has no text blocks to link.</p>}
    </div>
    <div className={s.actions}><button type="button" disabled={busy} onClick={close}>Cancel</button></div>
  </dialog>;
}
