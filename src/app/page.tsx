"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTeamspace, RequestError } from "@/lib/client";
import { useTaskDraftLock } from "@/lib/use-task-draft-lock";
import MarkdownText from "./components/MarkdownText";
import TaskTemplates from "./components/TaskTemplates";
import { taskContent, taskDescription, taskBlockTypes, templateDefaults, duplicateTask } from "@/lib/task-pages";
import { decodeTaskDraft, taskDraftBaseline, type TaskSavePacket, type TaskDraftRecord } from "@/lib/task-drafts";
import { useCollaborativeNote } from "@/lib/use-collaborative-note";
import type { Task, NoteContent, Attachment, BoardView } from "@/lib/model";
import {
  flattenNoteTree,
  filterVisibleNoteTree,
  noteAncestors,
  noteDescendants,
  assertNoteParent,
} from "@/lib/note-tree";
import s from "./page.module.css";
import BlockEditor from "./components/BlockEditor";
import { blockMarkdown } from "@/lib/markdown-shortcuts";
import { exportNoteMarkdown } from "@/lib/note-export";
import { matchNote } from "@/lib/note-search";
import SetupGuide from "./components/SetupGuide";
import { PageHistoryAction } from "./components/PageHistory";
import Conversation from "./components/Conversation";
import AuthPanel from "./components/AuthPanel";
import TaskCalendar from "./components/TaskCalendar";
import TicketViews, { SavedViewLink } from "./components/TicketViews";
import TaskTable from "./components/TaskTable";
import Projects from "./components/Projects";
import RecoveryArchives from "./components/RecoveryArchives";
import WorkspaceAccess, { MemberAdder } from "./components/WorkspaceAccess";
import { BoardProperties, TaskPropertyInputs, TaskPropertySummary } from "./components/BoardProperties";
import { changedPropertyValues } from "@/lib/board-properties";
import { defaultBoardView, linkedBoardTasks } from "@/lib/linked-content";
import LinkedBoardSettings from "./components/LinkedBoardSettings";
import { SyncedContentScope } from "./components/SyncedContent";
import {
  deadlineState,
  matchesDeadline,
  type DeadlineFilter,
} from "@/lib/task-deadlines";
import { useLocalDay } from "@/lib/use-local-day";
import { taskEditPatch } from "@/lib/task-status";
import { buildInviteUrl } from "@/lib/app-url";

type Api = ReturnType<typeof useTeamspace>;
type View = "views" | "projects" | "board" | "table" | "calendar" | "notes" | "members";
type Status = Task["status"];
const columns: { id: Status; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "?"
  );
}
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    views: <path d="M3 5h18M6 12h12M9 19h6" />,
    projects: <path d="M3 5h7l2 3h9v13H3z" />,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M10 4v16" /></>,
    board: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="11" rx="1" />
        <rect x="17" y="4" width="4" height="14" rx="1" />
      </>
    ),
    notes: (
      <>
        <path d="M14 3H5v18h14V8z" />
        <path d="M14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    members: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 3v5M16 3v5M4 11h16" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8z" />
        <path d="M14 3v5h5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
function Avatar({ name }: { name: string }) {
  return (
    <span className={s.avatar} title={name}>
      {initials(name)}
    </span>
  );
}
function ErrorMessage({ message }: { message: string }) {
  return (
    <div className={s.error} role="alert">
      {message}
    </div>
  );
}
function contentText(content: NoteContent) {
  return content.blocks.map(blockMarkdown).join("\n\n");
}
function Attachments({
  api,
  type,
  id,
}: {
  api: Api;
  type: "task" | "note";
  id: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const items = api.attachments.filter(
    (a: Attachment) => a.parentId === id && a.parentType === type,
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The file action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Attachments">
      <h3 className={s.sectionHeading}>
        Attachments {items.length > 0 && `(${items.length})`}
      </h3>
      {error && <ErrorMessage message={error} />}
      {items.map((a) => (
        <div className={s.attachment} key={a.id}>
          <Icon name="file" />
          <button
            disabled={busy}
            onClick={() => void run(() => api.downloadAttachment(a.id))}
          >
            {a.originalName}
          </button>
          <small>
            {a.status === "deleting"
              ? "Deletion pending — retry below"
              : `${(a.bytes / 1024).toFixed(0)} KB`}
          </small>
          <button
            className={s.danger}
            disabled={busy}
            aria-label={`Delete ${a.originalName}`}
            onClick={() => {
              if (confirm(`Delete ${a.originalName}?`))
                void run(() => api.deleteAttachment(a.id));
            }}
          >
            Delete
          </button>
        </div>
      ))}
      <label className={s.upload}>
        {busy ? "Working on your file…" : "Add an image or PDF · Up to 15 MB"}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void run(async () => {
                await api.uploadAttachment(file, type, id, original);
                if (fileInput.current) fileInput.current.value = "";
              });
          }}
        />
      </label>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={original}
          onChange={(e) => setOriginal(e.target.checked)}
        />
        Keep original (maximum 10 MB)
      </label>
    </section>
  );
}

function taskDraftFields(task: Partial<Task>) {
    return {
      title: task.title ?? "", description: task.description ?? "", content: taskContent({ description: task.description ?? "", content: task.content }),
      status: task.status ?? ("todo" as Status), assigneeId: task.assigneeId ?? "", dueDate: task.dueDate ?? "",
      projectId: task.projectId ?? "", priority: task.priority ?? ("none" as NonNullable<Task["priority"]>),
      estimate: task.estimate ?? null, propertyValues: task.propertyValues ?? {},
    };
}

function TaskDialog({
  api,
  initial,
  close,
  onProject,
  onDuplicate,
}: {
  api: Api;
  onProject: (id: string) => void;
  onDuplicate: (task: Partial<Task>) => void;
  initial: Partial<Task>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const taskApi = useRef(api);
  useEffect(() => { taskApi.current = api; }, [api]);
  const taskActive = useRef(true);
  useEffect(() => { taskActive.current = true; return () => { taskActive.current = false; }; }, []);
  const recoveryKey = `teamspace-task-draft-v1:${api.user?.uid ?? "preview"}:${api.workspace!.id}:${initial.id ?? "new"}`;
  const [recovered, setRecovered] = useState(() => {
    try {
      const raw = localStorage.getItem(recoveryKey);
      return { record: raw ? decodeTaskDraft(raw, initial.id) : null, error: "" };
    } catch (error) { return { record: null, error: error instanceof Error ? error.message : "Task recovery could not be read." }; }
  });
  const [baseline, setBaseline] = useState(() => recovered.record?.baseline ?? taskDraftBaseline(initial.id ? initial : {}));
  const [draft, setDraft] = useState(() => taskDraftFields(recovered.record?.draft ?? initial));
  const [packet, setPacket] = useState<TaskSavePacket | null>(() => recovered.record?.packet ?? null);
  const [storageError, setStorageError] = useState(recovered.error);
  const [composing, setComposing] = useState(false);
  const [review, setReview] = useState<Task | null>(null);
  const saved = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [commentRecoveryRisk, setCommentRecoveryRisk] = useState(false);
  const changed = JSON.stringify(templateDefaults({ ...draft, projectId: draft.projectId || undefined })) !==
    JSON.stringify(templateDefaults({ ...taskDraftFields(baseline), projectId: baseline.projectId || undefined }));
  const onDraftAcquired = useCallback(async () => {
    try {
      const raw = localStorage.getItem(recoveryKey);
      if (raw) {
        const record = decodeTaskDraft(raw, initial.id);
        setRecovered({ record, error: "" }); setBaseline(record.baseline);
        setDraft(taskDraftFields(record.draft)); setPacket(record.packet);
      } else if (initial.id) {
        const latest = await taskApi.current.readTask(initial.id);
        setBaseline(taskDraftBaseline(latest)); setDraft(taskDraftFields(latest)); setPacket(null);
      }
    } catch (error) { setRecovered({ record: null, error: error instanceof Error ? error.message : "Task recovery could not be read." }); }
  }, [recoveryKey, initial.id]);
  const ownsDraft = useTaskDraftLock(recoveryKey, onDraftAcquired);
  const locked = busy || packet !== null || !ownsDraft;
  useEffect(() => {
    if (ownsDraft) dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [ownsDraft]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || !ownsDraft || saved.current || recovered.error) return;
      try {
        if (!changed && !packet) { localStorage.removeItem(recoveryKey); setStorageError(""); return; }
        const record: TaskDraftRecord = { version: 1, baseline, draft: { ...draft, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null, projectId: draft.projectId || null }, packet };
        localStorage.setItem(recoveryKey, JSON.stringify(record));
        setStorageError("");
      } catch { setStorageError("This task draft could not be stored on this device. Download it before leaving. Saving will retry storage before sending."); }
    });
    return () => { active = false; };
  }, [baseline, draft, packet, recoveryKey, recovered.error, ownsDraft, changed]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (!saved.current && (changed || packet || composing)) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [changed, packet, composing]);
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([recovered.error ? (localStorage.getItem(recoveryKey) ?? "No stored recovery data") : JSON.stringify({ version: 1, baseline, draft, packet }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "task-draft.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function attemptClose() {
    if (busy) return;
    if (
      commentRecoveryRisk &&
      !confirm(
        "Your comment draft could not be stored on this device. Copy or download it before leaving. Close anyway?",
      )
    )
      return;
    if (!busy && (!(changed || packet || composing) || confirm(packet ? "This save may already have reached the server. Keep its exact retry locally and close?" : storageError ? "This task draft could not be stored. Download it before closing. Close anyway?" : "Keep this task draft on this device and close?")))
      close();
  }
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element?.close();
      prior?.focus();
    };
  }, []);
  async function save() {
    if (busy || composing || !ownsDraft) return;
    if (
      commentRecoveryRisk &&
      !confirm(
        "Your comment draft could not be stored. Copy or download it before saving and closing this task. Continue anyway?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const edited = {
        title: draft.title.trim(), description: taskDescription(draft.content),
        status: draft.status, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null,
        ...(api.projectsEnabled ? { projectId: draft.projectId || null, priority: draft.priority, estimate: draft.estimate } : {}),
      };
      const propertyValues = changedPropertyValues(baseline.propertyValues, draft.propertyValues);
      const contentChanged = JSON.stringify(taskContent({ description: baseline.description ?? "", content: baseline.content })) !== JSON.stringify(draft.content);
      const changes = initial.id ? {
        ...taskEditPatch(baseline, edited),
        ...(contentChanged ? { content: draft.content } : {}),
        ...(Object.keys(propertyValues).length ? { propertyValues } : {}),
      } : { ...edited, content: draft.content, propertyValues: draft.propertyValues };
      if (!packet && initial.id && !Object.keys(changes).length) { saved.current = true; localStorage.removeItem(recoveryKey); close(); return; }
      const next: TaskSavePacket = packet ?? { ...changes, ...(initial.id ? { id: initial.id, expectedRevision: baseline.revision ?? 0 } : {}), operationId: crypto.randomUUID() };
      if (recovered.error) throw new Error("Stored recovery needs review. Download it and explicitly discard it before saving a new draft.");
      try { localStorage.setItem(recoveryKey, JSON.stringify({ version: 1, baseline, draft: { ...draft, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null, projectId: draft.projectId || null }, packet: next })); }
      catch { setStorageError("Saving is blocked because this task draft could not be stored. Download it before leaving, or free browser storage and retry."); throw new Error("Task draft could not be stored. No request was sent."); }
      setPacket(next);
      await api.saveTask(next as Parameters<Api["saveTask"]>[0]);
      if (!taskActive.current) return;
      saved.current = true;
      try { localStorage.removeItem(recoveryKey); } catch { /* An accepted retry remains safe if device cleanup fails. */ }
      close();
    } catch (e) {
      if (e instanceof RequestError && (e.code === "revision_conflict" || (!packet && e.status >= 400 && e.status < 500))) setPacket(null);
      setError(
        e instanceof Error
          ? e.message
          : "Task could not be saved. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      commentRecoveryRisk &&
      !confirm(
        "Your comment draft could not be stored. Copy or download it before deleting this task. Continue anyway?",
      )
    )
      return;
    if (
      !initial.id ||
      !confirm("Delete this task, its attachments and conversation?")
    )
      return;
    setBusy(true);
    try {
      await api.deleteTask(initial.id);
      if (!taskActive.current) return;
      saved.current = true;
      try { localStorage.removeItem(recoveryKey); } catch { /* Local recovery cleanup can be retried later. */ }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Task could not be deleted.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`${s.dialog} ${s.taskPage}`}
      aria-labelledby="task-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        attemptClose();
      }}
    >
      <div className={s.taskFrame}>
        <div className={s.dialogHeader}>
          <h2 id="task-dialog-title">
            {initial.id ? "Task page" : "Create a task"}
          </h2>
          <details className={s.taskActions} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label="Task actions">···</summary>
            <div>
              {initial.id && <button type="button" disabled={locked || changed || composing || commentRecoveryRisk || Boolean(recovered.error)} title={changed ? "Save your changes before duplicating" : "Open an independent copy to review before saving"} onClick={event => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                try {
                  const newKey = `teamspace-task-draft-v1:${api.user?.uid ?? "preview"}:${api.workspace!.id}:new`;
                  if (localStorage.getItem(newKey)) { setCopyError("You already have a new-task draft on this device. Finish it from Add task before making a copy."); return; }
                  onDuplicate(duplicateTask({ ...draft, ...(api.projectsEnabled ? {} : { projectId: undefined, priority: undefined, estimate: undefined }) }));
                } catch { setCopyError("The copy could not be opened. Your task is unchanged."); }
              }}>Duplicate task</button>}
              <button type="button" onClick={downloadDraft}>Download task draft</button>
            </div>
          </details>
          <button
            type="button"
            className={s.close}
            onClick={attemptClose}
            aria-label="Close task editor"
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className={s.dialogBody}>
          {error && <ErrorMessage message={error} />}
          {copyError && <ErrorMessage message={copyError} />}
          {!ownsDraft && <p role="status">This task draft is read-only while another tab owns it or browser locking is unavailable. Close its other editor to continue here. Draft recovery reloads when ownership transfers.</p>}
          {storageError && <p role="alert">{storageError}</p>}
          {recovered.error && <button type="button" disabled={!ownsDraft} onClick={() => { if (confirm("Discard the unreadable stored task draft? Download recovery data first if you need it.")) { try { localStorage.removeItem(recoveryKey); setRecovered({ record: null, error: "" }); setStorageError(""); } catch { setStorageError("Browser storage is unavailable."); } } }}>Discard unreadable recovery data</button>}
          {recovered.record && <p className={s.hint}>Recovered a task draft from this device. Review it before saving.</p>}
          {packet && !busy && <p role="status">A save is waiting for acknowledgement. Retry sends the same request; editing is paused to avoid duplicate tasks.</p>}
          {initial.id && error && !packet && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { setReview(await api.readTask(initial.id!)); } catch (error) { setError(error instanceof Error ? error.message : "Could not load the latest task."); } finally { setBusy(false); } }}>Review latest saved task</button>}
          {review && <section aria-label="Review latest task"><h3>Latest saved task</h3><div className={s.taskReview}><h4>{review.title}</h4><p>Status: {columns.find(column => column.id === review.status)?.label} · Assignee: {api.members.find(member => member.id === review.assigneeId)?.displayName ?? "Unassigned"} · Due: {review.dueDate ?? "No date"}</p>{api.projectsEnabled && <p>Project: {api.projects.find(project => project.id === review.projectId)?.name ?? "None"} · Priority: {review.priority ?? "none"} · Estimate: {review.estimate ?? "Unset"}</p>}<TaskPropertySummary task={review} properties={api.boardProperties} members={api.members} projects={api.projects} /><MarkdownText text={exportNoteMarkdown(review.title, taskContent(review)).markdown} /></div><button type="button" disabled={busy} onClick={() => {
            const intent = taskEditPatch(baseline, { title: draft.title, description: taskDescription(draft.content), status: draft.status, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null, ...(api.projectsEnabled ? { projectId: draft.projectId || null, priority: draft.priority, estimate: draft.estimate } : {}) });
            const bodyChanged = JSON.stringify(taskContent({ description: baseline.description ?? "", content: baseline.content })) !== JSON.stringify(draft.content);
            setDraft(taskDraftFields({ ...review, ...intent, content: bodyChanged ? draft.content : taskContent(review), propertyValues: { ...review.propertyValues, ...changedPropertyValues(baseline.propertyValues, draft.propertyValues) } }));
            setBaseline(taskDraftBaseline(review)); setReview(null); setError("");
          }}>Keep my edits over this reviewed version</button></section>}
          <fieldset disabled={locked} className={s.taskFields}>
          <label className={`${s.field} ${s.taskTitle}`}>
            <span>Task name</span>
            <input
              autoFocus
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What needs to happen?"
            />
          </label>
          <div className={s.taskTools}>
            <TaskTemplates api={api} current={templateDefaults({ ...draft, ...(api.projectsEnabled ? {} : { projectId: undefined, priority: undefined, estimate: undefined }) })} disabled={locked} canApply={!initial.id} onApply={defaults => setDraft(taskDraftFields(defaults))} />
          </div>
          <div className={s.taskAttributes}>
          <div className={s.fieldRow}>
            <label className={s.field}>
              Status
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as Status })
                }
              >
                {columns.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              Assignee
              <select
                value={draft.assigneeId}
                onChange={(e) =>
                  setDraft({ ...draft, assigneeId: e.target.value })
                }
              >
                <option value="">Unassigned</option>
                {api.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={s.field}>
            Due date
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
            />
          </label>
          {api.projectsEnabled && <>
            {initial.projectId && <button type="button" disabled={busy || changed || commentRecoveryRisk} title="Save or discard edits before opening the project" onClick={()=>{close();onProject(initial.projectId!);}}>Open linked project ↗</button>}
            <label className={s.field}>Project<select disabled={busy} value={draft.projectId} onChange={event=>setDraft({...draft,projectId:event.target.value})}>
              <option value="">No project</option>{api.projects.map(project=><option key={project.id} value={project.id} disabled={project.archived && project.id!==initial.projectId}>{project.name}{project.archived?" (archived)":""}</option>)}
            </select></label>
            <div className={s.fieldRow}>
              <label className={s.field}>Priority<select disabled={busy} value={draft.priority} onChange={event=>setDraft({...draft,priority:event.target.value as typeof draft.priority})}>{["none","low","medium","high","urgent"].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
              <label className={s.field}>Estimate<input disabled={busy} type="number" min="0" max="1000000" step="any" value={draft.estimate??""} onChange={event=>setDraft({...draft,estimate:event.target.value===""?null:event.target.valueAsNumber})}/></label>
            </div>
          </>}
          <TaskPropertyInputs api={api} properties={api.boardProperties} values={draft.propertyValues} disabled={locked} members={api.members} projects={api.projects} projectId={draft.projectId}
            onChange={(id, value) => setDraft(previous => ({ ...previous, propertyValues: { ...previous.propertyValues, [id]: value } }))} />
          </div>
          </fieldset>
          <section className={s.taskBody} aria-label="Task body">
            <BlockEditor value={draft.content} allowedBlockTypes={taskBlockTypes} disabled={locked} onCompositionPendingChange={setComposing} onChange={content => setDraft(previous => ({ ...previous, content }))} />
          </section>
          {initial.id ? (
            <Attachments api={api} type="task" id={initial.id} />
          ) : null}
          {initial.id ? (
            <Conversation
              key={`${api.user?.uid || "preview"}:${api.workspace!.id}:task:${initial.id}`}
              api={api}
              parentType="task"
              parentId={initial.id}
              disabled={busy}
              onRecoveryRisk={setCommentRecoveryRisk}
            />
          ) : null}
        </div>
        <div className={s.dialogActions}>
          {initial.id && (
            <button
              type="button"
              className={s.danger}
              disabled={locked}
              onClick={() => void remove()}
            >
              Delete task
            </button>
          )}
          <button
            type="button"
            className={s.secondary}
            onClick={attemptClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="button" className={s.primary} onClick={() => void save()} disabled={busy || composing || !ownsDraft || !draft.title.trim() || Boolean(recovered.error)}>
            {busy ? "Saving…" : packet ? "Retry save" : "Save task"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function WorkspaceBoard({
  api,
  shown,
  onTask,
  filtered = false,
  view,
}: {
  api: Api;
  shown: Task[];
  onTask: (task: Partial<Task>) => void;
  filtered?: boolean;
  view?: BoardView;
}) {
  const today = useLocalDay();
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [moving, setMoving] = useState<Record<string, Status>>({});
  const inFlight = useRef(new Set<string>());
  const filterControl = useRef<HTMLSelectElement>(null);
  const [moveError, setMoveError] = useState<{
    id: string;
    status: Status;
    message: string;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  async function moveTask(
    task: Task,
    status: Status,
    origin?: HTMLSelectElement,
  ) {
    if (inFlight.current.has(task.id)) return;
    setMoveError(null);
    if (task.status === status) {
      setAnnouncement(
        `${task.title} is already in ${columns.find((column) => column.id === status)?.label}.`,
      );
      return;
    }
    inFlight.current.add(task.id);
    setMoving((previous) => ({ ...previous, [task.id]: status }));
    setAnnouncement(`Moving ${task.title}…`);
    try {
      await api.setTaskStatus(task.id, status);
      setAnnouncement(
        `${task.title} moved to ${columns.find((column) => column.id === status)?.label}.`,
      );
    } catch (error) {
      setAnnouncement("");
      setMoveError({
        id: task.id,
        status,
        message:
          error instanceof Error
            ? error.message
            : "The task could not be moved. Try again.",
      });
    } finally {
      inFlight.current.delete(task.id);
      setMoving((previous) => {
        const next = { ...previous };
        delete next[task.id];
        return next;
      });
      // Moving a card removes its control from the column. Restore a stable focus
      // target unless the user has already moved focus to something else.
      if (
        origin &&
        (document.activeElement === origin ||
          document.activeElement === document.body)
      )
        filterControl.current?.focus();
    }
  }
  const visible = linkedBoardTasks(shown, view ?? defaultBoardView, api.user?.uid ?? "preview", today).filter((task) =>
    matchesDeadline(task, deadlineFilter, today),
  );
  return (
    <>
      <div className={s.deadlineToolbar}>
        <label>
          Due date
          <select
            ref={filterControl}
            value={deadlineFilter}
            onChange={(event) =>
              setDeadlineFilter(event.target.value as DeadlineFilter)
            }
          >
            <option value="all">All tasks</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
            <option value="undated">No due date</option>
          </select>
        </label>
        <span role="status">
          {visible.length} of {shown.length} tasks
          {deadlineFilter !== "all" ? " · Open tasks only" : ""}
        </span>
        {deadlineFilter !== "all" && (
          <button
            className={s.secondary}
            onClick={() => setDeadlineFilter("all")}
          >
            Clear due-date filter
          </button>
        )}
      </div>
      <BoardProperties api={api} />
      <p className={s.moveAnnouncement} role="status">
        {announcement}
      </p>
      {moveError && (
        <div className={s.moveError} role="alert">
          <span>{moveError.message}</span>
          <button
            className={s.secondary}
            onClick={() => {
              const current = api.tasks.find(
                (task) => task.id === moveError.id,
              );
              if (current) void moveTask(current, moveError.status);
              else setMoveError(null);
            }}
          >
            {api.tasks.some((task) => task.id === moveError.id)
              ? "Retry move"
              : "Dismiss"}
          </button>
        </div>
      )}
      <div className={s.board}>
        {columns.map((c) => (
          <section
            key={c.id}
            className={`${s.column} ${s[c.id] || ""}`}
            aria-label={c.label}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("application/x-teamspace-task");
              const current = api.tasks.find((t) => t.id === id);
              if (current && current.status !== c.id)
                void moveTask(current, c.id);
            }}
          >
            <h2 className={s.columnHeader}>
              <span className={s.dot} />
              {c.label}
              <span className={s.count}>
                {visible.filter((t) => t.status === c.id).length}
              </span>
              <button
                aria-label={`Add task to ${c.label}`}
                onClick={() => onTask({ status: c.id })}
              >
                +
              </button>
            </h2>
            {visible
              .filter((t) => t.status === c.id)
              .map((t) => {
                const assignee = api.members.find((m) => m.id === t.assigneeId);
                const date = t.dueDate
                  ? new Date(`${t.dueDate}T12:00:00`)
                  : null;
                const deadline = deadlineState(t, today);
                return (
                  <article
                    key={t.id}
                    className={s.card}
                    aria-busy={Boolean(moving[t.id])}
                  >
                    <button
                      className={s.cardOpen}
                      draggable={!moving[t.id]}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/x-teamspace-task",
                          t.id,
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onTask(t)}
                      aria-label={`Edit task: ${t.title}${t.dueDate ? `, due ${t.dueDate}` : ", no due date"}${deadline === "overdue" ? ", overdue" : deadline === "today" ? ", due today" : ""}`}
                    >
                      <span className={s.cardTag}>
                        {t.status === "done" ? "COMPLETED" : "TASK"}
                      </span>
                      <h3>{t.title}</h3>
                      {t.description && <p>{t.description}</p>}
                      <TaskPropertySummary task={t} properties={api.boardProperties} members={api.members} projects={api.projects} />
                      <div className={s.cardFooter}>
                        <span
                          className={`${s.due} ${deadline === "overdue" ? s.overdue : deadline === "today" ? s.dueToday : ""}`}
                        >
                          {date ? (
                            <>
                              <Icon name="calendar" size={12} />
                              {date.toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                              {deadline === "overdue"
                                ? " · Overdue"
                                : deadline === "today"
                                  ? " · Today"
                                  : ""}
                            </>
                          ) : (
                            "No due date"
                          )}
                        </span>
                        {assignee ? (
                          <Avatar name={assignee.displayName} />
                        ) : (
                          <span>Unassigned</span>
                        )}
                      </div>
                    </button>
                    <div className={s.cardStatus}>
                      <span>{moving[t.id] ? "Moving…" : "Status"}</span>
                      <select
                        aria-label={`Status for ${t.title}`}
                        value={moving[t.id] ?? t.status}
                        disabled={Boolean(moving[t.id])}
                        onChange={(event) =>
                          void moveTask(
                            t,
                            event.target.value as Status,
                            event.currentTarget,
                          )
                        }
                      >
                        {columns.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                );
              })}
            {!visible.some((t) => t.status === c.id) && (
              <p className={s.emptyColumn}>
                {filtered || deadlineFilter !== "all"
                  ? "No matching tasks."
                  : c.id === "done"
                    ? "Small wins go here.\nYou’ve got this."
                    : "A little room for what’s next."}
              </p>
            )}
            <button
              className={s.addCard}
              onClick={() => onTask({ status: c.id })}
            >
              + &nbsp; Add a task
            </button>
          </section>
        ))}
      </div>
    </>
  );
}

type Draft = {
  parentId: string | null;
  title: string;
  content: NoteContent;
  revision: number;
  baseline: string;
  metadataBaseline?: string;
  live?: boolean;
  state: "Unsaved" | "Saved" | "Saving" | "Failed";
  error?: string;
};
type NoteSelection = { id: string | null; newParentId: string | null };
function Notes({
  api,
  search,
  onDirtyChange,
  onTask,
}: {
  onTask: (task: Partial<Task>) => void;
  api: Api;
  search: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const workspaceId = api.workspace!.id;
  const [selections, setSelections] = useState<Record<string, NoteSelection>>(
    {},
  );
  const selection = selections[workspaceId] || { id: null, newParentId: null };
  const selected = selection.id;
  const [commentRisk, setCommentRisk] = useState({ key: "", risk: false });
  function selectNote(id: string | null, newParentId: string | null = null) {
    if (linkedRisk.key === key && linkedRisk.risk && !confirm("Linked edits are still syncing or have a preserved draft. Finish composing and download any failed linked draft before leaving. Switch pages anyway?")) return;
    if (
      commentRisk.key === key &&
      commentRisk.risk &&
      !confirm(
        "Your comment draft could not be stored on this device. Copy or download it before leaving. Switch pages anyway?",
      )
    )
      return;
    if (!id) requestAnimationFrame(() => noteTitleRef.current?.focus());
    setSelections((prev) => ({ ...prev, [workspaceId]: { id, newParentId } }));
    const reveal = id
      ? noteAncestors(api.notes, id)
      : newParentId
        ? [
            ...noteAncestors(api.notes, newParentId),
            ...api.notes.filter((n) => n.id === newParentId),
          ]
        : [];
    setExpanded((prev) => {
      const next = { ...prev };
      reveal.forEach((n) => {
        next[`${workspaceId}:${n.id}`] = true;
      });
      return next;
    });
  }
  const selectionKey = (value: NoteSelection) =>
    value.id || `new:${value.newParentId || "root"}`;
  const key = `${workspaceId}:${selectionKey(selection)}`;
  const onCommentRisk = useCallback(
    (risk: boolean) => {
      setCommentRisk((previous) =>
        risk || previous.key === key ? { key, risk } : previous,
      );
    },
    [key],
  );
  const noteTitleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selected) noteTitleRef.current?.focus();
  }, [key, selected]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [exportError, setExportError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [noteMenu, setNoteMenu] = useState<{
    id: string;
    workspaceId: string;
    x: number;
    y: number;
  } | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  function closeNoteMenu() {
    setNoteMenu(null);
    menuTrigger.current?.focus();
  }
  function openNoteMenu(
    id: string,
    trigger: HTMLElement,
    x: number,
    y: number,
  ) {
    menuTrigger.current = trigger;
    setNoteMenu({
      id,
      workspaceId,
      x: Math.max(8, Math.min(x, window.innerWidth - 228)),
      y: Math.max(8, Math.min(y, window.innerHeight - 155)),
    });
  }

  const remote = api.notes.find((n) => n.id === selected);
  const baseline = (
    title: string,
    content: NoteContent,
    parentId: string | null,
  ) => JSON.stringify([title, content, parentId]);
  const [compositionDraft, setCompositionDraft] = useState({
    key: "",
    pending: false,
  });
  const [linkedRisk, setLinkedRisk] = useState({ key: "", risk: false });
  const reportLinkedRisk = useCallback((risk: boolean) => setLinkedRisk({ key, risk }), [key]);
  const composingNote =
    compositionDraft.key === key && compositionDraft.pending;
  const cached = drafts[key];
  const cacheIsDirty =
    cached &&
    (cached.live
      ? JSON.stringify([cached.title, cached.parentId]) !==
        cached.metadataBaseline
      : baseline(cached.title, cached.content, cached.parentId) !==
        cached.baseline);
  const liveEnabled = Boolean(
    api.configured && selected && ((remote && !cacheIsDirty) || cached?.live),
  );
  const collaboration = useCollaborativeNote({
    api,
    noteId: selected,
    enabled: liveEnabled,
  });
  const metadataRevision = remote?.metadataRevision ?? remote?.revision;
  const keepCached =
    cached &&
    (cacheIsDirty ||
      cached.state === "Saving" ||
      cached.error ||
      !remote ||
      (cached.live ? (metadataRevision ?? 0) : remote.revision) <=
        cached.revision);
  const draft: Draft =
    (keepCached ? cached : undefined) ||
    (remote
      ? {
          title: remote.title,
          content: remote.content,
          parentId: remote.parentId,
          revision: liveEnabled
            ? (metadataRevision ?? remote.revision)
            : remote.revision,
          metadataBaseline: JSON.stringify([remote.title, remote.parentId]),
          live: liveEnabled,
          baseline: baseline(remote.title, remote.content, remote.parentId),
          state: "Saved",
        }
      : {
          title: "",
          content: { blocks: [{ type: "paragraph", text: "" }] },
          parentId: selection.newParentId,
          revision: 0,
          baseline: baseline(
            "",
            { blocks: [{ type: "paragraph", text: "" }] },
            selection.newParentId,
          ),
          state: "Unsaved",
        });
  const displayedContent =
    liveEnabled && collaboration.ready && collaboration.content
      ? collaboration.content
      : draft.content;
  const dirty = liveEnabled
    ? JSON.stringify([draft.title, draft.parentId]) !==
      (draft.metadataBaseline ||
        JSON.stringify([remote?.title, remote?.parentId]))
    : baseline(draft.title, draft.content, draft.parentId) !== draft.baseline;
  const currentHistoryScope = `${api.user?.uid || "preview"}:${key}`;
  const historyBlockedReason =
    api.loading || !remote
      ? "Wait until the current saved page has loaded."
      : dirty || composingNote || (linkedRisk.key === key && linkedRisk.risk)
        ? "Save your title and location, and finish editing before saving or restoring a version. Your draft is preserved."
        : draft.state === "Saving"
          ? "Wait for the current save to finish."
          : draft.error || draft.state === "Failed"
            ? "Resolve the failed save before saving or restoring a version."
            : liveEnabled &&
                (!collaboration.ready ||
                  collaboration.pending ||
                  collaboration.error ||
                  collaboration.status !== "Saved")
              ? "Wait for acknowledged synchronization, or recover pending edits before saving or restoring a version."
              : null;
  const anyDirty =
    (linkedRisk.key === key && linkedRisk.risk) ||
    (commentRisk.key === key && commentRisk.risk) ||
    compositionDraft.pending ||
    collaboration.pending ||
    Object.values(drafts).some((d) =>
      d.live
        ? JSON.stringify([d.title, d.parentId]) !== d.metadataBaseline
        : baseline(d.title, d.content, d.parentId) !== d.baseline,
    );
  useEffect(() => {
    onDirtyChange(anyDirty);
    function preventLoss(e: BeforeUnloadEvent) {
      if (anyDirty) e.preventDefault();
    }
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [anyDirty, onDirtyChange]);
  const conflict = Boolean(
    !api.loading &&
    selected &&
    drafts[key] &&
    dirty &&
    (!remote ||
      (liveEnabled
        ? (metadataRevision ?? 0) > draft.revision
        : remote.revision !== draft.revision)),
  );
  const children = api.notes.filter(
    (n) => n.parentId === selected && selected !== null,
  );
  const descendants = selected
    ? noteDescendants(api.notes, selected)
    : new Set<string>();
  const currentAncestors = selected ? noteAncestors(api.notes, selected) : [];
  const parent = api.notes.find((n) => n.id === draft.parentId);
  const breadcrumbs = parent
    ? [...noteAncestors(api.notes, parent.id), parent]
    : [];
  const flattened = flattenNoteTree(api.notes);
  const query = search.trim().toLowerCase();
  const matching = new Set<string>();
  const excerpts = new Map<string, string>();
  if (query)
    for (const note of api.notes) {
      const match = matchNote(note, query);
      if (match.matches) {
        matching.add(note.id);
        if (match.excerpt) excerpts.set(note.id, match.excerpt);
        noteAncestors(api.notes, note.id).forEach((n) => matching.add(n.id));
      }
    }
  const forcedOpen = new Set(currentAncestors.map((n) => n.id));
  if (!selected && parent)
    [...noteAncestors(api.notes, parent.id), parent].forEach((n) =>
      forcedOpen.add(n.id),
    );
  const isExpanded = (id: string) =>
    Boolean(query || (expanded[`${workspaceId}:${id}`] ?? forcedOpen.has(id)));
  const visibleTree = filterVisibleNoteTree(
    flattened,
    isExpanded,
    query ? matching : undefined,
  );
  const newDrafts = Object.entries(drafts).filter(
    ([draftKey, value]) =>
      draftKey.startsWith(`${workspaceId}:new:`) &&
      baseline(value.title, value.content, value.parentId) !== value.baseline,
  );
  function update(patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...draft,
        ...(liveEnabled
          ? {
              live: true,
              metadataBaseline:
                draft.metadataBaseline ||
                JSON.stringify([remote?.title, remote?.parentId]),
              revision: draft.live
                ? draft.revision
                : (metadataRevision ?? draft.revision),
            }
          : {}),
        ...patch,
        state: "Unsaved",
        error: patch.error,
      },
    }));
  }
  function changeLiveContent(content: NoteContent, base?: NoteContent) {
    collaboration.change(content, base || displayedContent);
    // Recovery snapshot only: collaborative content is never sent through Save note.
    setDrafts((previous) => ({
      ...previous,
      [key]: {
        ...draft,
        live: true,
        metadataBaseline:
          draft.metadataBaseline ||
          JSON.stringify([remote?.title, remote?.parentId]),
        content,
      },
    }));
  }
  function downloadMarkdown(archived?: NoteContent) {
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      const exported = exportNoteMarkdown(
        archived ? `${draft.title} — local archived recovery` : draft.title,
        archived ?? collaboration.recoveryContent ?? displayedContent,
      );
      url = URL.createObjectURL(
        new Blob([exported.markdown], { type: "text/markdown;charset=utf-8" }),
      );
      link.href = url;
      link.download = exported.filename;
      document.body.appendChild(link);
      link.click();
      setExportError(null);
    } catch {
      setExportError({
        key,
        message:
          "Download could not start. Your note and unsaved edits are unchanged. Please try again.",
      });
    } finally {
      link.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }
  async function save() {
    const capturedKey = key;
    setDrafts((prev) => ({
      ...prev,
      [capturedKey]: { ...draft, state: "Saving", error: undefined },
    }));
    try {
      if (draft.parentId && !api.notes.some((n) => n.id === draft.parentId))
        throw new Error(
          "The parent note is no longer available. Choose another location before saving.",
        );
      assertNoteParent(api.notes, selected, draft.parentId);
      const saved =
        liveEnabled && selected
          ? await api.saveNoteMetadata(selected, {
              title: draft.title.trim(),
              parentId: draft.parentId,
              expectedRevision: draft.revision,
            })
          : await api.saveNote({
              id: selected || undefined,
              title: draft.title.trim(),
              content: draft.content,
              parentId: draft.parentId,
              expectedRevision: selected ? draft.revision : undefined,
            });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[capturedKey];
        next[`${workspaceId}:${saved.id}`] = {
          ...draft,
          title: saved.title,
          parentId: saved.parentId,
          content: saved.content,
          live: liveEnabled,
          metadataBaseline: JSON.stringify([saved.title, saved.parentId]),
          revision: liveEnabled
            ? (saved.metadataRevision ?? saved.revision)
            : saved.revision,
          baseline: baseline(saved.title, saved.content, saved.parentId),
          state: "Saved",
        };
        return next;
      });
      if (saved.parentId) {
        const ancestors = [
          ...noteAncestors(api.notes, saved.parentId),
          ...api.notes.filter((n) => n.id === saved.parentId),
        ];
        setExpanded((prev) => {
          const next = { ...prev };
          ancestors.forEach((note) => {
            next[`${workspaceId}:${note.id}`] = true;
          });
          return next;
        });
      }
      setSelections((prev) =>
        selectionKey(prev[workspaceId] || { id: null, newParentId: null }) ===
        selectionKey(selection)
          ? { ...prev, [workspaceId]: { id: saved.id, newParentId: null } }
          : prev,
      );
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [capturedKey]: {
          ...draft,
          state: "Failed",
          error:
            e instanceof Error
              ? e.message
              : "Save failed. Your draft has been kept.",
        },
      }));
    }
  }
  async function remove() {
    if (
      !selected ||
      children.length ||
      !confirm("Delete this note and its attachments?")
    )
      return;
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...draft, state: "Saving", error: undefined },
    }));
    try {
      await api.deleteNote(selected);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSelections((prev) =>
        prev[workspaceId]?.id === selected
          ? {
              ...prev,
              [workspaceId]: {
                id: remote?.parentId || null,
                newParentId: null,
              },
            }
          : prev,
      );
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [key]: {
          ...draft,
          state: "Failed",
          error:
            e instanceof Error
              ? e.message
              : "Delete failed. Your draft is preserved.",
        },
      }));
    }
  }
  return (
    <div className={s.notes}>
      {noteMenu && noteMenu.workspaceId === workspaceId && (
        <>
          <button
            className={s.menuBackdrop}
            aria-label="Close note actions"
            onClick={closeNoteMenu}
          />
          <div
            className={s.noteContextMenu}
            role="menu"
            aria-label="Note actions"
            style={{ left: noteMenu.x, top: noteMenu.y }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeNoteMenu();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const items = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }
              if (e.key === "Tab") setNoteMenu(null);
            }}
          >
            <small>{api.notes.find((n) => n.id === noteMenu.id)?.title}</small>
            <button
              role="menuitem"
              ref={(el) => {
                el?.focus();
              }}
              disabled={api.loading}
              onClick={() => {
                selectNote(null, noteMenu.id);
                setNoteMenu(null);
                requestAnimationFrame(() => noteTitleRef.current?.focus());
              }}
            >
              ＋ Add subnote
            </button>
            <button
              role="menuitem"
              onClick={() => {
                selectNote(noteMenu.id);
                setNoteMenu(null);
                requestAnimationFrame(() => noteTitleRef.current?.focus());
              }}
            >
              ▤ Open note
            </button>
          </div>
        </>
      )}
      <aside className={s.noteList} aria-label="Nested notes navigation">
        <button
          className={s.secondary}
          disabled={api.loading}
          onClick={() => selectNote(null)}
        >
          <Icon name="plus" />
          New root note
        </button>
        <p className={s.hint}>
          {query
            ? "Searching titles and saved note text."
            : "Organize ideas into notes and subnotes."}
        </p>
        <ul className={s.noteTree} aria-label="Notes hierarchy">
          {visibleTree.map(({ note, depth }) => {
            const hasChildren = api.notes.some((n) => n.parentId === note.id);
            const localDraft = drafts[`${workspaceId}:${note.id}`];
            const unsaved =
              localDraft &&
              baseline(
                localDraft.title,
                localDraft.content,
                localDraft.parentId,
              ) !== localDraft.baseline;
            return (
              <li
                key={note.id}
                className={`${s.treeRow} ${selected === note.id ? s.treeSelected : ""}`}
                style={{ paddingLeft: depth * 14 + 4 }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const trigger =
                    e.currentTarget.querySelector<HTMLButtonElement>(
                      "button[data-note-title]",
                    );
                  if (trigger)
                    openNoteMenu(note.id, trigger, e.clientX, e.clientY);
                }}
              >
                {hasChildren ? (
                  <button
                    className={s.treeExpand}
                    aria-label={`${isExpanded(note.id) ? "Collapse" : "Expand"} ${note.title}`}
                    aria-expanded={isExpanded(note.id)}
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [`${workspaceId}:${note.id}`]: !isExpanded(note.id),
                      }))
                    }
                  >
                    {isExpanded(note.id) ? "⌄" : "›"}
                  </button>
                ) : (
                  <span className={s.treeLeaf} aria-hidden="true">
                    ▤
                  </span>
                )}
                <button
                  className={s.treeTitle}
                  data-note-title
                  onKeyDown={(e) => {
                    if (
                      e.key === "ContextMenu" ||
                      (e.shiftKey && e.key === "F10")
                    ) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openNoteMenu(
                        note.id,
                        e.currentTarget,
                        rect.left,
                        rect.bottom,
                      );
                    }
                  }}
                  title={note.title}
                  aria-label={note.title}
                  aria-describedby={
                    excerpts.has(note.id)
                      ? `note-match-${workspaceId}-${note.id}`
                      : undefined
                  }
                  aria-current={selected === note.id ? "page" : undefined}
                  onClick={() => selectNote(note.id)}
                >
                  {note.title}
                  {unsaved && (
                    <span className={s.draftDot} aria-label="Unsaved changes">
                      {" "}
                      •
                    </span>
                  )}
                  {excerpts.has(note.id) && (
                    <small
                      id={`note-match-${workspaceId}-${note.id}`}
                      className={s.noteExcerpt}
                    >
                      {excerpts.get(note.id)}
                    </small>
                  )}
                </button>
                <button
                  className={s.treeAction}
                  aria-label={`Add subnote to ${note.title}`}
                  title="Add subnote"
                  disabled={api.loading}
                  onClick={() => selectNote(null, note.id)}
                >
                  +
                </button>
                <button
                  className={s.treeAction}
                  aria-label={`Actions for ${note.title}`}
                  title="Note actions"
                  aria-haspopup="menu"
                  aria-expanded={noteMenu?.id === note.id}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    openNoteMenu(
                      note.id,
                      e.currentTarget,
                      rect.left,
                      rect.bottom,
                    );
                  }}
                >
                  ⋯
                </button>
              </li>
            );
          })}
        </ul>
        {!api.notes.length && (
          <p className={s.hint}>Your shared knowledge starts here.</p>
        )}
        {query && !visibleTree.length && (
          <p className={s.hint}>No matching notes.</p>
        )}
        {newDrafts.length > 0 && (
          <div className={s.draftList}>
            <p className={s.sideDraftLabel}>UNSAVED DRAFTS</p>
            {newDrafts.map(([draftKey, value]) => {
              const creationParent = draftKey.slice(
                `${workspaceId}:new:`.length,
              );
              return (
                <button
                  key={draftKey}
                  className={`${s.noteItem} ${key === draftKey ? s.selected : ""}`}
                  onClick={() =>
                    selectNote(
                      null,
                      creationParent === "root" ? null : creationParent,
                    )
                  }
                >
                  {value.title || "Untitled draft"}
                  <small>
                    {value.parentId
                      ? `Under ${api.notes.find((n) => n.id === value.parentId)?.title || "unavailable parent"}`
                      : "Root note"}
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </aside>
      <section className={s.editor} aria-label="Note editor">
        <nav className={s.noteBreadcrumbs} aria-label="Note breadcrumbs">
          <button onClick={() => selectNote(null)}>Notes</button>
          {breadcrumbs.map((n) => (
            <span key={n.id}>
              <span aria-hidden="true">/</span>
              <button title={n.title} onClick={() => selectNote(n.id)}>
                {n.title}
              </button>
            </span>
          ))}
          <span aria-hidden="true">/</span>
          <strong>{draft.title || "Untitled note"}</strong>
        </nav>
        <div className={s.editorToolbar}>
          <span aria-live="polite">
            {liveEnabled
              ? composingNote && collaboration.status === "Saved"
                ? "Saving…"
                : collaboration.status
              : conflict
                ? "Remote changes available"
                : draft.state === "Saved" && dirty
                  ? "Unsaved"
                  : draft.state}{" "}
            · {liveEnabled ? "Live content" : "Explicit save"}
            {liveEnabled &&
              (dirty ||
                draft.state === "Saving" ||
                draft.state === "Failed") && (
                <span>
                  {" "}
                  ·{" "}
                  {draft.state === "Saving"
                    ? "Saving title / location…"
                    : draft.error
                      ? "Title / location save failed"
                      : "Title / location unsaved"}
                </span>
              )}
          </span>
          <button
            className={s.secondary}
            disabled={api.loading}
            onClick={() => downloadMarkdown()}
            title="Download current note text, including unsaved edits. Board embeds are references; attachments and subnotes are not included."
          >
            Download Markdown
          </button>
          {selected && remote && (
            <PageHistoryAction
              key={currentHistoryScope}
              className={s.secondary}
              disabled={api.loading || draft.state === "Saving"}
              api={api}
              note={remote}
              blockedReason={historyBlockedReason}
              onRestored={() => {
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[key];
                  return next;
                });
                collaboration.retry();
              }}
            />
          )}
          {
            <button
              className={s.secondary}
              disabled={
                !selected || !remote || api.loading || draft.state === "Saving"
              }
              title={
                !selected
                  ? "Save this note first, then add a subnote"
                  : "Add a page inside this note"
              }
              onClick={() => selectNote(null, selected)}
            >
              <Icon name="plus" size={13} />
              Add subnote
            </button>
          }
          {selected && (
            <button
              className={s.secondary}
              onClick={() => void remove()}
              disabled={
                api.loading || draft.state === "Saving" || children.length > 0
              }
              title={
                children.length
                  ? "Move or delete this note’s subnotes first"
                  : "Delete this note"
              }
            >
              Delete
            </button>
          )}
          <button
            className={s.primary}
            onClick={() => void save()}
            disabled={
              api.loading ||
              !draft.title.trim() ||
              draft.state === "Saving" ||
              conflict ||
              (Boolean(selected) && !dirty)
            }
          >
            {draft.state === "Saving"
              ? "Saving…"
              : liveEnabled
                ? "Save title / location"
                : "Save note"}
          </button>
        </div>
        {liveEnabled && (
          <div className={s.collaborationInfo}>
            <span>
              Text and blocks sync automatically. Title and location use Save.
            </span>
            <span aria-label="People viewing this note">
              {collaboration.presence.length
                ? collaboration.presence
                    .map((person) => person.displayName)
                    .join(", ") + " · viewing recently"
                : "Live workspace note"}
            </span>
            <small>
              Pending work stays on this device when switching notes. Reopen it
              to resume synchronization.
            </small>
          </div>
        )}
        {api.configured && selected && !liveEnabled && (
          <p className={s.hint}>
            Save or download your existing draft before starting live
            collaboration. Your draft has been preserved.
          </p>
        )}
        {liveEnabled && collaboration.error && (
          <div className={s.banner} role="alert">
            <span>{collaboration.error}</span>
            <button className={s.secondary} onClick={collaboration.retry}>
              Retry synchronization
            </button>
            <span>Use Download Markdown to keep a recovery copy.</span>
            {collaboration.generationChanged && collaboration.pending && (
              <button
                className={s.secondary}
                onClick={() => {
                  if (
                    confirm(
                      "Keep pending old-version recovery locally and reload the restored page? The pending old version will remain in this browser and will not be merged into the restored page. Download a Markdown copy first if you need it elsewhere.",
                    )
                  ) {
                    void collaboration.discardRecoveryAndRetry();
                  }
                }}
              >
                Keep recovery locally &amp; reload
              </button>
            )}
          </div>
        )}
        {liveEnabled && collaboration.archivedRecoveryContent && (
          <div className={s.banner}>
            <span>
              A previous local recovery copy is kept in this browser. It is
              separate from the restored page and server history.
            </span>
            <button
              className={s.secondary}
              onClick={() =>
                downloadMarkdown(collaboration.archivedRecoveryContent!)
              }
            >
              Download archived recovery
            </button>
          </div>
        )}
        {liveEnabled && collaboration.archivedRecoveryError && (
          <div className={s.banner} role="alert">
            <span>{collaboration.archivedRecoveryError}</span>
            <button className={s.secondary} onClick={collaboration.retry}>
              Retry synchronization
            </button>
          </div>
        )}
        {liveEnabled && selected && api.user && api.workspace && <RecoveryArchives key={`${api.user.uid}:${key}`}
          scope={`${api.user.uid}:${api.workspace.id}:${selected}:archive-browser`} title={draft.title || "Untitled note"} />}
        {children.length > 0 && (
          <p className={s.hint} style={{ marginBottom: 14 }}>
            This note has {children.length}{" "}
            {children.length === 1 ? "subnote" : "subnotes"}. Move or delete
            them before deleting this note.
          </p>
        )}
        {conflict && (
          <div className={s.banner}>
            <div>
              <strong>This note changed while you were editing.</strong>
              <p>
                Your draft and its location are preserved. Copy your draft
                before reloading to keep your version.
              </p>
              <button
                className={s.secondary}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      `${draft.title}\n\n${contentText(displayedContent)}`,
                    )
                    .catch(() =>
                      update({
                        error:
                          "Clipboard unavailable. Select and copy the editor text manually.",
                      }),
                    );
                }}
              >
                Copy my draft
              </button>
              {remote && (
                <button
                  className={s.secondary}
                  onClick={() => {
                    if (
                      confirm(
                        "Replace your local draft and location with the latest saved version?",
                      )
                    )
                      setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                  }}
                >
                  Reload latest
                </button>
              )}
            </div>
          </div>
        )}
        {exportError?.key === key && (
          <ErrorMessage message={exportError.message} />
        )}
        {draft.error && <ErrorMessage message={draft.error} />}
        <label className={s.noteLocation}>
          Move to parent
          <select
            aria-label="Move note to parent"
            value={draft.parentId || ""}
            disabled={api.loading || draft.state === "Saving"}
            onChange={(e) => update({ parentId: e.target.value || null })}
          >
            <option value="">Workspace root</option>
            {draft.parentId && !parent && (
              <option value={draft.parentId}>
                Parent unavailable — choose another
              </option>
            )}
            {flattened
              .filter(
                ({ note }) => note.id !== selected && !descendants.has(note.id),
              )
              .map(({ note, depth }) => (
                <option value={note.id} key={note.id}>
                  {"\u00a0".repeat(depth * 2)}
                  {note.title}
                </option>
              ))}
          </select>
          <small>
            Location changes are applied when you save. Shared with workspace —
            all subnotes inherit membership.
          </small>
        </label>
        <input
          className={s.noteTitle}
          ref={noteTitleRef}
          aria-label="Note title"
          maxLength={160}
          placeholder="Untitled note"
          value={draft.title}
          disabled={api.loading || draft.state === "Saving"}
          onChange={(e) => update({ title: e.target.value })}
        />
        <SyncedContentScope key={`${api.user?.uid ?? "preview"}:${key}`} api={api} noteId={selected} content={displayedContent}
          main={liveEnabled ? collaboration : null}
          onChangeMain={(content, base) => liveEnabled ? changeLiveContent(content, base) : update({ content })}
          onOpen={id => selectNote(id)} onRiskChange={reportLinkedRisk}>
        <BlockEditor
          key={key}
          api={api}
          renderBoard={(block, onViewChange, disabled) => (
            <>
            <SavedViewLink api={api} view={block.boardView} disabled={disabled} onApply={onViewChange}/>
            {block.boardView?.savedViewId && api.projectsEnabled ? <TicketViews key={block.boardView.savedViewId} api={api} onTask={onTask} viewId={block.boardView.savedViewId}/> : <>
            <LinkedBoardSettings view={block.boardView} members={api.members} disabled={disabled} onApply={onViewChange} />
            <WorkspaceBoard
              key={`${api.workspace?.id}:${block.id ?? "board"}`}
              api={api}
              shown={api.tasks}
              onTask={onTask}
              view={block.boardView}
              filtered={Boolean(block.boardView)}
            /></>}
            </>
          )}
          value={displayedContent}
          onCompositionPendingChange={(pending) =>
            setCompositionDraft({ key, pending })
          }
          onChange={(content, base) =>
            liveEnabled ? changeLiveContent(content, base) : update({ content })
          }
          collaborativeHistory={
            liveEnabled
              ? {
                  undo: collaboration.undo,
                  redo: collaboration.redo,
                  canUndo: collaboration.canUndo,
                  canRedo: collaboration.canRedo,
                }
              : undefined
          }
          disabled={
            liveEnabled
              ? !collaboration.ready || collaboration.readOnly
              : api.loading || draft.state === "Saving"
          }
          onAddSubnote={
            selected && remote ? () => selectNote(null, selected) : undefined
          }
        />
        </SyncedContentScope>
        {selected && (
          <div className={s.subnoteSection}>
            <div className={s.subnoteHeading}>
              <strong>Subnotes</strong>
              <button
                className={s.secondary}
                disabled={api.loading || draft.state === "Saving"}
                onClick={() => selectNote(null, selected)}
              >
                + Add subnote
              </button>
            </div>
            {children.length ? (
              children.map((note) => (
                <button
                  key={note.id}
                  className={s.subnoteLink}
                  onClick={() => selectNote(note.id)}
                >
                  <Icon name="notes" />
                  {note.title}
                  <span>↗</span>
                </button>
              ))
            ) : (
              <p className={s.hint}>
                Keep related ideas together. Add a page inside this note.
              </p>
            )}
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 30 }}>
            <Attachments api={api} type="note" id={selected} />
          </div>
        )}
        {selected && remote ? (
          <Conversation
            key={`${api.user?.uid || "preview"}:${workspaceId}:note:${selected}`}
            api={api}
            parentType="note"
            parentId={selected}
            disabled={api.loading || draft.state === "Saving"}
            onRecoveryRisk={onCommentRisk}
          />
        ) : (
          <p className={s.hint}>Save your page to start a conversation.</p>
        )}
      </section>
    </div>
  );
}

function Members({ api }: { api: Api }) {
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const owner = api.workspace?.ownerId === api.user?.uid;
  const manageAdmins = owner || api.isRootAdmin;
  const manageMembers = manageAdmins || api.members.some((member) => member.id === api.user?.uid && member.role === "admin");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.members}>
      {error && <ErrorMessage message={error} />}
      {api.configured && manageMembers && api.workspace && <MemberAdder key={`${api.user?.uid}:${api.workspace.id}`} api={api} workspaceId={api.workspace.id} />}
      {api.isRootAdmin && <WorkspaceAccess key={api.user?.uid} api={api} />}
      <section className={s.panel}>
        <h2>Good work happens together.</h2>
        <p>
          Invite your teammates to share this board, project notes, and files.
        </p>
        {!api.configured ? (
          <p>Invitations are available after shared workspace configuration.</p>
        ) : manageMembers ? (
          <>
            {invite && (
              <>
                <input
                  readOnly
                  aria-label="Invite link"
                  className={s.inviteLink}
                  value={invite}
                />
                <button
                  className={s.secondary}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(invite);
                      setCopied(true);
                    })
                  }
                >
                  {copied ? "Copied!" : "Copy link"}
                </button>{" "}
              </>
            )}
            <button
              className={s.primary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.createInvite();
                  setInvite(
                    result.includes("?invite=")
                      ? result
                      : buildInviteUrl(result),
                  );
                  setCopied(false);
                })
              }
            >
              {busy ? "Working…" : "Create invite link"}
            </button>{" "}
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Revoke the current invitation? Existing members keep access.",
                  )
                )
                  void run(async () => {
                    await api.revokeInvite();
                    setInvite("");
                  });
              }}
            >
              Revoke invite
            </button>
          </>
        ) : (
          <p>Ask a workspace admin for an invitation link.</p>
        )}
      </section>
      <section className={s.panel}>
        <h2>
          Workspace members{" "}
          <span className={s.count}>{api.members.length}</span>
        </h2>
        {api.members.map((m) => (
          <div className={s.memberRow} key={m.id}>
            <Avatar name={m.displayName} />
            <div className={s.memberInfo}>
              {m.displayName}
              {m.id === api.user?.uid && " (you)"}
              <small>{m.role === "owner" ? "Workspace owner" : m.role === "admin" ? "Workspace admin" : "Member"}</small>
            </div>
            {api.configured && manageMembers && m.id !== api.user?.uid && m.role !== "owner" && (
              <>
                {manageAdmins && (
                  <button className={s.secondary} disabled={busy} onClick={() => {
                    if (confirm(`${m.role === "admin" ? "Remove admin access from" : "Make workspace admin:"} ${m.displayName}?`))
                      void run(() => api.changeMemberRole(m.id, m.role === "admin" ? "member" : "admin"));
                  }}>{m.role === "admin" ? "Make member" : "Make admin"}</button>
                )}
                {owner && (
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Transfer workspace ownership to ${m.displayName}?`,
                      )
                    )
                      void run(() => api.transferOwner(m.id));
                  }}
                >
                  Make owner
                </button>
                )}
                {(manageAdmins || m.role === "member") && (
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${m.displayName} from this workspace?`))
                      void run(() => api.removeMember(m.id));
                  }}
                >
                  Remove
                </button>
                )}
              </>
            )}
          </div>
        ))}
      </section>
      {api.configured && !owner && (
        <button
          className={s.secondary}
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                "Leave this workspace? You will need an invitation to return.",
              )
            )
              void run(() => api.leaveWorkspace());
          }}
        >
          Leave workspace
        </button>
      )}
      {owner && (
        <p className={s.hint}>
          To leave this workspace, transfer ownership to another member first.
        </p>
      )}
    </div>
  );
}

function WorkspaceSetup({ api }: { api: Api }) {
  const [name, setName] = useState("");
  const [tokenDraft, setToken] = useState<string | null>(null);
  const incomingToken = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => new URLSearchParams(location.search).get("invite") || "",
    () => "",
  );
  const token = tokenDraft ?? incomingToken;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to continue. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.onboarding}>
      <main className={s.welcome}>
        <div className={s.brand}>
          <span className={s.brandMark}>t</span>teamspace
        </div>
        <h1>
          A little space.
          <br />
          For your next big idea.
        </h1>
        <p>
          Bring the work, the people, and the ideas together. One focused home
          for your team.
        </p>
        {(error || api.error) && <ErrorMessage message={error || api.error!} />}{" "}
        {!api.user ||
        api.needsEmailConfirmation ||
        api.passwordRecovery ||
        api.authConfigurationError ||
        !api.authConfiguration ? (
          <AuthPanel api={api} />
        ) : (
          <>
            {api.isRootAdmin && <WorkspaceAccess key={api.user?.uid} api={api} />}
            <button className={s.secondary} disabled={busy} onClick={() => void run(api.refreshWorkspaces)}>Refresh workspace list</button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.createWorkspace(name.trim()));
              }}
            >
              <label className={s.field}>
                Workspace name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your team or project"
                />
              </label>
              <button className={s.primary} disabled={busy || !name.trim()}>
                Create workspace
              </button>
            </form>
            <div className={s.separator} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                let value = token.trim();
                try {
                  value = new URL(value).searchParams.get("invite") || value;
                } catch {
                  /* Raw tokens are also accepted. */
                }
                void run(() => api.joinWorkspace(value));
              }}
            >
              <label className={s.field}>
                Have an invitation?
                <input
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste an invite link or token"
                />
              </label>
              <button className={s.secondary} disabled={busy || !token.trim()}>
                Join a workspace
              </button>
            </form>
            <button
              className={s.secondary}
              style={{ marginTop: 20 }}
              onClick={() => void run(api.signOut)}
            >
              Sign out
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function WorkspaceDialog({
  api,
  initialToken,
  close,
}: {
  api: Api;
  initialToken: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element?.close();
      prior?.focus();
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      close();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to open this workspace. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="workspace-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={s.dialogHeader}>
        <h2 id="workspace-dialog-title">A new space for your team</h2>
        <button
          className={s.close}
          aria-label="Close workspace setup"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </div>
      <div className={s.dialogBody}>
        {error && <ErrorMessage message={error} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.createWorkspace(name.trim()));
          }}
        >
          <label className={s.field}>
            Workspace name
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your team or project"
            />
          </label>
          <button className={s.primary} disabled={busy || !name.trim()}>
            Create workspace
          </button>
        </form>
        <div className={s.separator} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            let value = token.trim();
            try {
              value = new URL(value).searchParams.get("invite") || value;
            } catch {
              /* Raw tokens are also accepted. */
            }
            void run(() => api.joinWorkspace(value));
          }}
        >
          <label className={s.field}>
            Join with an invitation
            <input
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste an invite link or token"
            />
          </label>
          <button className={s.secondary} disabled={busy || !token.trim()}>
            Join workspace
          </button>
        </form>
      </div>
    </dialog>
  );
}
export default function Home() {
  const api = useTeamspace();
  const [chosenView, setView] = useState<View>("board");
  const view = ["projects","views"].includes(chosenView) && !api.projectsEnabled ? "board" : chosenView;
  useEffect(()=>{
    const open=()=>{if(new URLSearchParams(location.search).has("ticketView"))setView("views");};
    queueMicrotask(open);window.addEventListener("popstate",open);return()=>window.removeEventListener("popstate",open);
  },[]);
  const [projectSelection,setProjectSelection] = useState<{scope:string;id:string}|null>(null);
  const [search, setSearch] = useState("");
  const [taskSelection, setTaskSelection] = useState<{
    scope: string;
    value: Partial<Task>;
  } | null>(null);
  const taskScope = `${api.user?.uid || "preview"}:${api.workspace?.id || "none"}`;
  const task = taskSelection?.scope === taskScope ? taskSelection.value : null;
  function setTask(value: Partial<Task> | null) {
    setTaskSelection(value ? { scope: taskScope, value } : null);
    const url=new URL(location.href);if(value?.id){url.searchParams.set("ticket",value.id);if(api.workspace)url.searchParams.set("workspace",api.workspace.id);}else url.searchParams.delete("ticket");history.replaceState(null,"",url);
  }
  const restoredWorkspace=useRef("");
  useEffect(()=>{
    const params=new URLSearchParams(location.search),workspaceId=params.get("workspace"),ticketId=params.get("ticket"),projectId=params.get("project");
    if(workspaceId){const key=`${api.user?.uid??"preview"}:${workspaceId}`;if(restoredWorkspace.current!==key){if(workspaceId!==api.workspace?.id){if(api.workspaces.some(workspace=>workspace.id===workspaceId)){restoredWorkspace.current=key;api.selectWorkspace(workspaceId);}return;}restoredWorkspace.current=key;}if(workspaceId!==api.workspace?.id)return;}
    if(ticketId&&task?.id!==ticketId){const linked=api.tasks.find(item=>item.id===ticketId);if(linked)queueMicrotask(()=>setTaskSelection({scope:taskScope,value:linked}));}
    if(projectId&&!params.has("ticketView")&&(projectSelection?.id!==projectId||projectSelection.scope!==taskScope)&&api.projectsEnabled){queueMicrotask(()=>{setProjectSelection({scope:taskScope,id:projectId});setView("projects");});}
  },[api,task?.id,taskScope,projectSelection?.id,projectSelection?.scope]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [dismissedInvite, setDismissedInvite] = useState("");
  const incomingInvite = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => new URLSearchParams(location.search).get("invite") || "",
    () => "",
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const dirtyNotes = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyNotes.current = dirty;
  }, []);
  function signOut() {
    if (
      !dirtyNotes.current ||
      confirm("Sign out and discard your unsaved note drafts?")
    )
      void run(api.signOut);
  }
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That change could not be saved. Please try again.",
      );
    }
  }
  if (api.loading && !api.workspace)
    return (
      <div className={s.onboarding}>
        <div className={s.busy} role="status">
          Opening your workspace…
        </div>
      </div>
    );
  if (
    !api.workspace ||
    (api.configured &&
      (!api.user ||
        api.needsEmailConfirmation ||
        api.passwordRecovery ||
        api.authConfigurationError))
  )
    return <WorkspaceSetup api={api} />;
  const shown = api.tasks.filter(
    (t) =>
      `${t.title} ${t.description}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!filter ||
        t.assigneeId === (api.configured ? api.user?.uid : "preview")),
  );
  const title =
    view === "views" ? "Your saved views" : view === "projects" ? "Your projects" : view === "board"
      ? "Project board"
      : view === "table"
        ? "Your task table"
      : view === "calendar"
        ? "Your task calendar"
        : view === "notes"
          ? "Project notes"
          : "Your people";
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          <span className={s.brandMark}>t</span>teamspace
        </div>
        <select
          className={s.workspaceSelect}
          value={api.workspace.id}
          aria-label="Active workspace"
          onChange={(e) => {
            const url=new URL(location.href);for(const key of ["ticket","project","ticketView","ticketQuery"])url.searchParams.delete(key);url.searchParams.set("workspace",e.target.value);history.replaceState(null,"",url);
            api.selectWorkspace(e.target.value);
            setTask(null);
          }}
        >
          {api.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {api.configured && (
          <button className={s.workspaceAction} onClick={() => void run(api.refreshWorkspaces)}>Refresh workspace list</button>
        )}
        {api.configured && (
          <button
            className={s.workspaceAction}
            onClick={() => setWorkspaceDialog(true)}
          >
            + Create or join workspace
          </button>
        )}
        <p className={s.sideLabel}>WORKSPACE</p>
        <nav className={s.nav} aria-label="Main navigation">
          {([...(api.projectsEnabled ? ["projects","views"] : []), "board", "table", "calendar", "notes", "members"] as View[]).map((v) => (
            <button
              key={v}
              className={view === v ? s.active : ""}
              onClick={() => {setView(v);if(v!=="views"){const url=new URL(location.href);for(const key of ["ticketView","ticketQuery","project"])url.searchParams.delete(key);history.replaceState(null,"",url);}}}
              aria-current={view === v ? "page" : undefined}
            >
              <Icon name={v} />
              {v === "views" ? "Views" : v === "projects" ? "Projects" : v === "board" ? "Board" : v === "table" ? "Table" : v === "calendar" ? "Calendar" : v === "notes" ? "Notes" : "Members"}
              {v === "board" && (
                <span className={s.navCount}>{api.tasks.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className={s.sidebarBottom}>
          <div className={s.sideCard}>
            <h3>A shared space. A shared goal.</h3>
            <p>Big things start with a small team working together.</p>
            <button onClick={() => setView("members")}>
              Invite your teammates ↗
            </button>
          </div>
          <div className={s.profile}>
            <Avatar name={api.user?.displayName || "Local explorer"} />
            <div>
              <strong>{api.user?.displayName || "Local explorer"}</strong>
              <small>
                {api.configured ? "Your personal account" : "Preview mode"}
              </small>
            </div>
            {api.configured && <button onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </aside>
      <main className={s.main}>
        <header className={s.topbar}>
          <div className={s.breadcrumb}>
            {api.workspace.name}
            <span>/</span>
            <strong>
              {view === "views" ? "Saved views" : view === "projects" ? "Projects" : view === "board"
                ? "Board"
                : view === "table"
                  ? "Table"
                : view === "calendar"
                  ? "Calendar"
                  : view === "notes"
                    ? "Notes"
                    : "Members"}
            </strong>
          </div>
          <div className={s.topbarRight}>
            <label className={s.search}>
              <Icon name="search" size={14} />
              <input
                ref={searchRef}
                aria-label="Search tasks and notes"
                placeholder="Search anything…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <Avatar name={api.user?.displayName || "You"} />
          </div>
        </header>
        <div
          className={`${s.surface} ${!api.configured ? s.previewSurface : ""}`}
        >
          {!api.configured && (
            <div className={s.banner}>
              <strong>LOCAL PREVIEW</strong>
              <span>
                This device only. No sign-in, shared team data, or private cloud
                storage is connected.
              </span>
            </div>
          )}
          {(error || api.error) && (
            <div className={s.error} role="alert">
              {error || api.error}
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
                  api.clearError();
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className={s.hero}>
            <div>
              <p className={s.eyebrow}>LET’S MAKE SOMETHING GREAT</p>
              <h1>{title}</h1>
              <p className={s.subtitle}>
                {view === "views" ? "Filter, sort and group the same tasks in reusable views." : view === "projects" ? "Organize shared work and follow its linked tasks." : view === "board"
                  ? "A clear view of what’s next. One task at a time."
                  : view === "table"
                    ? "Compare tasks and custom fields in one place."
                  : view === "calendar"
                    ? "Make room for what matters. Plan your team’s work by day."
                    : view === "notes"
                      ? "Keep the ideas, decisions, and details in one place."
                      : "A small team can do extraordinary things."}
              </p>
            </div>
            {(view === "board" || view === "table" || view === "calendar") && (
              <button
                className={s.primary}
                onClick={() => setTask({ status: "todo" })}
              >
                <Icon name="plus" size={15} />
                Add task
              </button>
            )}
          </div>
          <div className={s.toolbar}>
            <div className={s.viewLabel}>
              <Icon name={view} />
              {view === "views" ? "Saved views" : view === "projects" ? "Projects" : view === "board"
                ? "Board view"
                : view === "table"
                  ? "Table view"
                : view === "calendar"
                  ? "Calendar view"
                  : view === "notes"
                    ? "All notes"
                    : "Team directory"}
              <span>
                {view === "board" || view === "table" || view === "calendar"
                  ? `${api.tasks.length} tasks in this workspace`
                  : view === "notes"
                    ? `${api.notes.length} shared documents`
                    : "Better, together"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {(view === "board" || view === "table" || view === "calendar") && (
                <button
                  className={s.secondary}
                  aria-pressed={filter}
                  onClick={() => setFilter(!filter)}
                >
                  {filter ? "My tasks ✓" : "All assignees"}
                </button>
              )}
              <div className={s.people}>
                {api.members.slice(0, 4).map((m) => (
                  <Avatar key={m.id} name={m.displayName} />
                ))}
                <span className={s.peopleText}>
                  {api.members.length}{" "}
                  {api.members.length === 1 ? "member" : "members"}
                </span>
              </div>
            </div>
          </div>
          {api.loading && (
            <p className={s.busy} role="status">
              Loading workspace…
            </p>
          )}
          <div hidden={view !== "board"}>
            <WorkspaceBoard
              key={api.workspace.id}
              api={api}
              shown={shown}
              onTask={setTask}
              filtered={Boolean(search || filter)}
            />
          </div>
          <div hidden={view !== "notes"}>
            <Notes
              api={api}
              search={search}
              onDirtyChange={onDirtyChange}
              onTask={setTask}
            />
          </div>
          {view === "calendar" && (
            <TaskCalendar
              key={taskScope}
              tasks={shown}
              members={api.members}
              filtered={Boolean(search || filter)}
              onTask={setTask}
            />
          )}
          {view === "table" && <>
            <TaskTable key={taskScope} api={api} tasks={shown} properties={api.boardProperties} members={api.members} projects={api.projects} extended={api.projectsEnabled}
              filtered={Boolean(search || filter)} onTask={setTask} />
          </>}
          {view === "projects" && api.projectsEnabled && <Projects key={taskScope} api={api} onTask={setTask} search={search} onSelect={id=>{setProjectSelection({scope:taskScope,id});const url=new URL(location.href);url.searchParams.set("project",id);url.searchParams.set("workspace",api.workspace!.id);history.replaceState(null,"",url);}} initialSelection={projectSelection?.scope===taskScope?projectSelection.id:null} />}
          {view === "views" && api.projectsEnabled && !api.loading && <TicketViews key={taskScope} api={api} onTask={setTask} />}
          {view === "members" && <Members key={api.workspace.id} api={api} />}
          <footer className={s.footer}>
            <span>
              <span className={s.dot} />
              {api.configured
                ? "Shared workspace · Live task updates"
                : "Local prototype · Stored on this device"}
            </span>
            <span>A little progress, every day.</span>
          </footer>
        </div>
      </main>
      {!api.configured && <SetupGuide />}
      {task && (
        <TaskDialog
          key={`${taskScope}:${task.id || "new"}`}
          api={api}
          initial={task}
          onDuplicate={setTask}
          onProject={id=>{setProjectSelection({scope:taskScope,id});setView("projects");const url=new URL(location.href);url.searchParams.set("project",id);url.searchParams.set("workspace",api.workspace!.id);url.searchParams.delete("ticketView");url.searchParams.delete("ticketQuery");history.replaceState(null,"",url);}}
          close={() => setTask(null)}
        />
      )}
      {api.configured &&
        (workspaceDialog ||
          (incomingInvite && dismissedInvite !== incomingInvite)) && (
          <WorkspaceDialog
            api={api}
            initialToken={incomingInvite}
            close={() => {
              setWorkspaceDialog(false);
              setDismissedInvite(incomingInvite);
            }}
          />
        )}
    </div>
  );
}
