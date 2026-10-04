"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { collection, getFirestore, onSnapshot } from "firebase/firestore";
import type { Attachment, Member, Note, Task, Workspace, PageVersion, PageVersionSummary } from "./model";
import { checkpointLocalPage, nameLocalVersion, restoreLocalPage, visibleVersions, reconcilePageSnapshots, type LocalPageHistory } from "./page-history";
import { prepareImage } from "./images";
import { assertNoteParent } from "./note-tree";
import { updateTaskStatus } from "./task-status";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const configured = Object.values(config).every(Boolean);
export const browserConfigurationStatus = [
  { name: "NEXT_PUBLIC_FIREBASE_API_KEY", present: Boolean(config.apiKey) },
  {
    name: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    present: Boolean(config.authDomain),
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    present: Boolean(config.projectId),
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    present: Boolean(config.storageBucket),
  },
  { name: "NEXT_PUBLIC_FIREBASE_APP_ID", present: Boolean(config.appId) },
];
const demoWorkspace: Workspace = {
  id: "preview",
  name: "Campus collective",
  ownerId: "preview",
};
const demoTasks: Task[] = [
  {
    id: "brief",
    title: "Shape the project brief",
    description: "Agree on the problem, audience, and what success looks like.",
    status: "todo",
    assigneeId: "preview",
    dueDate: null,
    position: 0,
  },
  {
    id: "research",
    title: "Gather research & references",
    description: "Bring three useful sources to our next meeting.",
    status: "doing",
    assigneeId: null,
    dueDate: null,
    position: 1,
  },
  {
    id: "kickoff",
    title: "Kick off the team workspace",
    description: "One place for our work and our thinking.",
    status: "done",
    assigneeId: "preview",
    dueDate: null,
    position: 2,
  },
];
type Preview = { tasks: Task[]; notes: Note[]; histories?: Record<string, LocalPageHistory> };
export type DocumentPresence = {
  id: string;
  displayName: string;
  uid: string;
  expiresAt: number;
};
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export function useTeamspace() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(
    configured ? [] : [demoWorkspace],
  );
  const [workspace, setWorkspace] = useState<Workspace | null>(
    configured ? null : demoWorkspace,
  );
  const [tasks, setTasks] = useState<Task[]>(configured ? [] : demoTasks);
  const [notes, setNotes] = useState<Note[]>([]);
  const [members, setMembers] = useState<Member[]>(
    configured
      ? []
      : [{ id: "preview", displayName: "You (local preview)", role: "owner" }],
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [watchEpoch, setWatchEpoch] = useState(0);
  const preview = useRef<Preview>({ tasks: demoTasks, notes: [] });
  const ready = useRef(false);
  const noteObservers = useRef(
    new Set<{
      workspaceId: string;
      noteId: string;
      next: (note: Note) => void;
      fail: (error: Error) => void;
    }>(),
  );
  const noteSnapshot = useRef<{ workspaceId: string; rows: Note[] } | null>(
    null,
  );
  const report = useCallback((e: unknown) => {
    const message =
      e instanceof Error
        ? e.message
        : "Something went wrong. Please try again.";
    setError(message);
    return new Error(message);
  }, []);
  const api = useCallback(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      expectedUid?: string,
    ) => {
      const auth = getAuth(getApps().length ? getApp() : initializeApp(config));
      if (!auth.currentUser) throw new Error("Sign in to continue.");
      if (expectedUid && auth.currentUser.uid !== expectedUid)
        throw new RequestError(
          "The signed-in account changed. Reopen this document in the original account to recover its pending edits.",
          401,
          "account_changed",
        );
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new RequestError(
          data.error?.message ??
            "The request failed. Your draft has been kept.",
          response.status,
          data.error?.code ?? "request_failed",
        );
      return data;
    },
    [],
  );
  const loadWorkspaces = useCallback(async () => {
    const expectedUid = getAuth(getApp()).currentUser?.uid;
    const data = await api("workspaces", "GET", undefined, expectedUid);
    if (getAuth(getApp()).currentUser?.uid !== expectedUid)
      return [] as Workspace[];
    setWorkspaces(data.workspaces);
    setWorkspace(
      (current) =>
        data.workspaces.find((w: Workspace) => w.id === current?.id) ??
        data.workspaces[0] ??
        null,
    );
    return data.workspaces as Workspace[];
  }, [api]);
  useEffect(() => {
    if (!configured) {
      let cancelled = false;
      // Browser storage is an external source; restore after hydration.
      Promise.resolve().then(() => {
        if (cancelled) return;
        try {
          const raw = localStorage.getItem("teamspace-preview-v1");
          if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.tasks) && Array.isArray(data.notes)) {
              data.notes = data.notes.map((note: Note) => ({
                ...note,
                parentId: note.parentId ?? null,
              }));
              preview.current = data;
              setTasks(data.tasks);
              setNotes(data.notes);
            }
          }
        } catch {
          setError(
            "Local preview could not be restored. Browser storage may be unavailable.",
          );
        }
        ready.current = true;
      });
      return () => {
        cancelled = true;
      };
    }
    const app = getApps().length ? getApp() : initializeApp(config);
    return onAuthStateChanged(getAuth(app), (next) => {
      setUser(next);
      setTasks([]);
      setNotes([]);
      setMembers([]);
      setAttachments([]);
      setWorkspace(null);
      setWorkspaces([]);
      if (next) {
        setLoading(true);
        loadWorkspaces()
          .then((rows) => {
            if (getAuth(app).currentUser?.uid !== next.uid) return;
            if (!rows.length) setLoading(false);
          })
          .catch((e) => {
            if (getAuth(app).currentUser?.uid !== next.uid) return;
            report(e);
            setLoading(false);
          });
      } else setLoading(false);
    });
  }, [loadWorkspaces, report]);
  useEffect(() => {
    if (!configured || !user || !workspace) return;
    const db = getFirestore(getApp());
    const loaded = new Set<string>();
    let active = true;
    const watch = <T>(name: string, set: (rows: T[]) => void) =>
      onSnapshot(
        collection(db, `workspaces/${workspace.id}/${name}`),
        (snapshot) => {
          if (!active) return;
          let rows =
            snapshot.docs
              .filter(
                (doc) =>
                  name !== "attachments" ||
                  ["ready", "deleting"].includes(doc.data().status),
              )
              .map(
                (doc) =>
                  ({
                    ...doc.data(),
                    ...(name === "notes"
                      ? { parentId: doc.data().parentId ?? null }
                      : {}),
                    id: doc.id,
                  }) as T,
              );
          if (name === "notes") {
            rows = reconcilePageSnapshots(
              noteSnapshot.current?.workspaceId === workspace.id ? noteSnapshot.current.rows : [],
              rows as Note[],
            ) as T[];
            noteSnapshot.current = {
              workspaceId: workspace.id,
              rows: rows as Note[],
            };
          }
          set(rows);
          if (name === "notes")
            for (const observer of noteObservers.current) {
              if (observer.workspaceId !== workspace.id) continue;
              const document = (rows as Note[]).find(
                (item) => item.id === observer.noteId,
              );
              if (document && !(document as Note & { deleting?: boolean }).deleting)
                observer.next(document);
              else
                observer.fail(
                  new RequestError(
                    "This note was removed. Export pending work before closing it.",
                    404,
                    "not_found",
                  ),
                );
            }
          loaded.add(name);
          if (loaded.size >= 4) setLoading(false);
        },
        (e) => {
          if (!active) return;
          if (name === "notes")
            for (const observer of noteObservers.current)
              if (observer.workspaceId === workspace.id) observer.fail(e);
          report(e);
          setLoading(false);
          set([]);
        },
      );
    const unsubs = [
      watch<Task>("tasks", setTasks),
      watch<Note>("notes", setNotes),
      watch<Member>("members", setMembers),
      watch<Attachment>("attachments", setAttachments),
    ];
    return () => {
      active = false;
      unsubs.forEach((unsub) => unsub());
    };
  }, [workspace, user, report, watchEpoch]);
  function persist(next: Preview) {
    if (!ready.current) throw new Error("The local preview is still loading.");
    try {
      localStorage.setItem("teamspace-preview-v1", JSON.stringify(next));
    } catch {
      throw new Error("Local saving failed. Your browser storage may be full.");
    }
    preview.current = next;
    setTasks(next.tasks);
    setNotes(next.notes);
  }
  async function action<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw report(e);
    }
  }
  function path() {
    if (!workspace) throw new Error("Choose a workspace first.");
    return `workspaces/${workspace.id}`;
  }
  async function unavailable(): Promise<never> {
    throw new Error(
      "This needs a configured Firebase project. Local preview has no shared access or file storage.",
    );
  }
  return {
    configured,
    user: user
      ? { uid: user.uid, displayName: user.displayName ?? "Teammate" }
      : null,
    loading,
    error,
    workspace,
    workspaces,
    tasks: tasks.toSorted((a, b) => a.position - b.position),
    notes,
    members,
    attachments,
    restartSubscriptions: () => setWatchEpoch((epoch) => epoch + 1),
    listPageHistory: async (noteId: string, before?: number) => {
      if (!configured) {
        if (!preview.current.notes.some(note => note.id === noteId)) throw new Error("The page no longer exists.");
        const rows = visibleVersions(preview.current.histories?.[noteId], Date.now()).filter(version => before === undefined || version.sourceRevision < before);
        return { versions: rows.slice(0, 20).map(({ content, ...summary }) => { void content; return summary; }), nextBefore: rows.length > 20 ? rows[19].sourceRevision : null };
      }
      return await api(`${path()}/notes/${noteId}/history${before === undefined ? "" : `?before=${before}`}`, "GET", undefined, user?.uid) as { versions: PageVersionSummary[]; nextBefore: number | null };
    },
    getPageVersion: async (noteId: string, versionId: string): Promise<PageVersion> => {
      if (!configured) {
        if (!preview.current.notes.some(note => note.id === noteId)) throw new Error("The page no longer exists.");
        const version = visibleVersions(preview.current.histories?.[noteId], Date.now()).find(item => item.id === versionId);
        if (!version) throw new Error("This version is missing or expired.");
        return structuredClone(version);
      }
      const data = await api(`${path()}/notes/${noteId}/history?version=${encodeURIComponent(versionId)}`, "GET", undefined, user?.uid);
      return data.version as PageVersion;
    },
    savePageVersion: async (noteId: string, expectedRevision: number, name: string): Promise<PageVersion> => {
      if (!configured) {
        const note = preview.current.notes.find(item => item.id === noteId);
        if (!note) throw new Error("The page no longer exists.");
        const history = nameLocalVersion(preview.current.histories?.[noteId], note, expectedRevision, name, Date.now());
        persist({ ...preview.current, histories: { ...preview.current.histories, [noteId]: history } });
        return structuredClone(history.versions.find(version => version.sourceRevision === expectedRevision)!);
      }
      const data = await api(`${path()}/notes/${noteId}/history`, "POST", { expectedRevision, name }, user?.uid);
      const full = await api(`${path()}/notes/${noteId}/history?version=${encodeURIComponent(data.versionId)}`, "GET", undefined, user?.uid);
      return full.version as PageVersion;
    },
    restorePageVersion: async (noteId: string, versionId: string, expectedRevision: number, operationId: string): Promise<Note> => {
      if (!configured) {
        const note = preview.current.notes.find(item => item.id === noteId);
        if (!note) throw new Error("The page no longer exists.");
        const restored = restoreLocalPage(preview.current.histories?.[noteId], note, versionId, expectedRevision, operationId, Date.now());
        persist({ ...preview.current, notes: preview.current.notes.map(item => item.id === noteId ? restored.note : item), histories: { ...preview.current.histories, [noteId]: restored.history } });
        return restored.note;
      }
      const boundWorkspace = workspace?.id;
      const boundUid = user?.uid;
      const data = await api(`${path()}/notes/${noteId}/restore`, "POST", { versionId, expectedRevision, operationId }, boundUid);
      const note = data.note as Note;
      const current = noteSnapshot.current;
      if (current && getAuth(getApp()).currentUser?.uid === boundUid && current.workspaceId === boundWorkspace) {
        const rows = current.rows.map(item => item.id === noteId && note.revision > item.revision ? note : item);
        noteSnapshot.current = { ...current, rows };
        setNotes(rows);
      }
      return note;
    },
    initializeCollaboration: async (noteId: string) => {
      if (!configured || !user) return unavailable();
      const data = await api(
        `${path()}/notes/${noteId}/collaboration`,
        "POST",
        {},
        user.uid,
      );
      return data.note as Note;
    },
    sendNoteUpdate: async (
      noteId: string,
      packet: { operationId: string; generation: string; update: string },
    ) => {
      if (!configured || !user) return unavailable();
      const data = await api(
        `${path()}/notes/${noteId}/updates`,
        "POST",
        packet,
        user.uid,
      );
      return data.note as Note;
    },
    saveNoteMetadata: async (
      noteId: string,
      metadata: {
        title: string;
        parentId: string | null;
        expectedRevision: number;
      },
    ) => {
      if (!configured || !user) return unavailable();
      const data = await api(
        `${path()}/notes/${noteId}/metadata`,
        "PATCH",
        metadata,
        user.uid,
      );
      return data.note as Note;
    },
    subscribeCollaboration: (
      noteId: string,
      next: (note: Note) => void,
      fail: (error: Error) => void,
    ) => {
      if (!workspace) throw new Error("Choose a workspace first.");
      const observer = { workspaceId: workspace.id, noteId, next, fail };
      noteObservers.current.add(observer);
      queueMicrotask(() => {
        if (
          !noteObservers.current.has(observer) ||
          noteSnapshot.current?.workspaceId !== workspace.id
        )
          return;
        const note = noteSnapshot.current.rows.find(
          (item) => item.id === noteId,
        );
        if (note) next(note);
      });
      return () => {
        noteObservers.current.delete(observer);
      };
    },
    subscribePresence: (
      noteId: string,
      next: (rows: DocumentPresence[]) => void,
      fail: (error: Error) => void,
    ) => {
      const db = getFirestore(getApp());
      let active = true;
      const unsubscribe = onSnapshot(
        collection(db, `${path()}/notes/${noteId}/presence`),
        (snapshot) => {
          if (!active) return;
          next(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
              expiresAt: document.data().expiresAt?.toMillis?.() ?? 0,
            })) as DocumentPresence[],
          );
        },
        (error) => {
          if (active) fail(error);
        },
      );
      return () => {
        active = false;
        unsubscribe();
      };
    },
    heartbeatPresence: async (noteId: string, sessionId: string) => {
      if (!user) return;
      await api(
        `${path()}/notes/${noteId}/presence`,
        "POST",
        { sessionId },
        user.uid,
      );
    },
    leavePresence: async (noteId: string, sessionId: string) => {
      if (!user) return;
      await api(
        `${path()}/notes/${noteId}/presence`,
        "DELETE",
        { sessionId },
        user.uid,
      );
    },
    clearError: () => setError(null),
    signIn: () =>
      action(async () => {
        const app = getApps().length ? getApp() : initializeApp(config);
        await signInWithPopup(getAuth(app), new GoogleAuthProvider());
      }),
    signOut: () => action(() => firebaseSignOut(getAuth(getApp()))),
    selectWorkspace: (id: string) => {
      setTasks([]);
      setNotes([]);
      setMembers([]);
      setAttachments([]);
      setLoading(true);
      setWorkspace(workspaces.find((w) => w.id === id) ?? null);
    },
    createWorkspace: (name: string) =>
      action(async () => {
        if (!configured) return unavailable();
        const data = await api("workspaces", "POST", { name });
        await loadWorkspaces();
        setWorkspace(data.workspace);
      }),
    joinWorkspace: (token: string) =>
      action(async () => {
        if (!configured) return unavailable();
        const data = await api("invites/redeem", "POST", { token });
        await loadWorkspaces();
        setTasks([]);
        setNotes([]);
        setMembers([]);
        setAttachments([]);
        setLoading(true);
        setWorkspace(data.workspace);
      }),
    saveTask: (task: Partial<Task> & ({ id: string } | { title: string })) =>
      action(async () => {
        if (!configured) {
          const current = task.id
            ? preview.current.tasks.find((item) => item.id === task.id)
            : undefined;
          if (task.id && !current)
            throw new Error(
              "This task no longer exists. Your changes have not been saved.",
            );
          const item = {
            description: "",
            status: "todo" as const,
            assigneeId: null,
            dueDate: null,
            position: preview.current.tasks.length,
            ...current,
            ...task,
            title: task.title ?? current?.title ?? "",
            id: task.id ?? crypto.randomUUID(),
          };
          persist({
            ...preview.current,
            tasks: [
              ...preview.current.tasks.filter((t) => t.id !== item.id),
              item,
            ],
          });
          return;
        }
        const body = Object.fromEntries(
          [
            "title",
            "description",
            "status",
            "assigneeId",
            "dueDate",
            "position",
          ]
            .filter((key) => key in task)
            .map((key) => [key, task[key as keyof Task]]),
        );
        await api(
          `${path()}/tasks${task.id ? `/${task.id}` : ""}`,
          task.id ? "PATCH" : "POST",
          body,
        );
      }),
    setTaskStatus: (id: string, status: Task["status"]) =>
      action(async () => {
        if (!configured) {
          persist({
            ...preview.current,
            tasks: updateTaskStatus(preview.current.tasks, id, status),
          });
          return;
        }
        if (!user) return unavailable();
        await api(`${path()}/tasks/${id}`, "PATCH", { status }, user.uid);
      }),
    deleteTask: (id: string) =>
      action(async () => {
        if (!configured) {
          persist({
            ...preview.current,
            tasks: preview.current.tasks.filter((t) => t.id !== id),
          });
          return;
        }
        await api(`${path()}/tasks/${id}`, "DELETE");
      }),
    saveNote: (note: {
      id?: string;
      title: string;
      content: Note["content"];
      expectedRevision?: number;
      parentId?: string | null;
    }) =>
      action(async () => {
        if (!configured) {
          const existing = preview.current.notes.find((n) => n.id === note.id);
          if (note.id && !existing)
            throw new Error(
              "This note was removed. Copy your draft into a new note.",
            );
          if (existing && existing.revision !== note.expectedRevision)
            throw new Error(
              "This note changed. Copy your draft before reloading.",
            );
          const item: Note = {
            id: note.id ?? crypto.randomUUID(),
            parentId:
              "parentId" in note
                ? (note.parentId ?? null)
                : (existing?.parentId ?? null),
            title: note.title,
            content: note.content,
            revision: (existing?.revision ?? 0) + 1,
          };
          assertNoteParent(
            preview.current.notes,
            existing?.id ?? null,
            item.parentId,
          );
          persist({
            ...preview.current,
            notes: [
              ...preview.current.notes.filter((n) => n.id !== item.id),
              item,
            ],
            histories: { ...preview.current.histories, [item.id]: checkpointLocalPage(preview.current.histories?.[item.id], item, Date.now()) },
          });
          return item;
        }
        const { id, ...body } = note;
        const data = await api(
          `${path()}/notes${id ? `/${id}` : ""}`,
          id ? "PATCH" : "POST",
          body,
        );
        return data.note as Note;
      }),
    deleteNote: (id: string) =>
      action(async () => {
        if (!configured) {
          if (preview.current.notes.some((note) => note.parentId === id))
            throw new Error(
              "Move or delete this note’s subnotes before deleting it.",
            );
          persist({
            ...preview.current,
            notes: preview.current.notes.filter((n) => n.id !== id),
            histories: Object.fromEntries(Object.entries(preview.current.histories ?? {}).filter(([noteId]) => noteId !== id)),
          });
          return;
        }
        await api(`${path()}/notes/${id}`, "DELETE");
      }),
    createInvite: () =>
      action(async () => {
        if (!configured) return unavailable();
        const data = await api(`${path()}/invites`, "POST", {});
        return `${location.origin}/?invite=${encodeURIComponent(data.token)}`;
      }),
    revokeInvite: () =>
      action(async () => {
        if (!configured) return unavailable();
        await api(`${path()}/invites`, "DELETE");
      }),
    removeMember: (uid: string) =>
      action(async () => {
        await api(`${path()}/members/${uid}`, "DELETE");
      }),
    leaveWorkspace: () =>
      action(async () => {
        if (!user) return unavailable();
        await api(`${path()}/members/${user.uid}`, "DELETE");
        await loadWorkspaces();
      }),
    transferOwner: (uid: string) =>
      action(async () => {
        await api(`${path()}/owner`, "PATCH", { uid });
        await loadWorkspaces();
      }),
    uploadAttachment: (
      file: File,
      parentType: "task" | "note",
      parentId: string,
      keepOriginal: boolean,
    ) =>
      action(async () => {
        if (!configured) return unavailable();
        const blob = await prepareImage(file, keepOriginal);
        const prefix = path();
        const data = await api(`${prefix}/attachments`, "POST", {
          parentType,
          parentId,
          originalName: file.name,
          contentType: blob.type,
          bytes: blob.size,
        });
        try {
          const response = await fetch(data.uploadUrl, {
            method: "PUT",
            headers: data.uploadHeaders,
            body: blob,
          });
          if (!response.ok) throw new Error("Upload failed. Please try again.");
          await api(
            `${prefix}/attachments/${data.attachmentId}/complete`,
            "POST",
            {},
          );
        } catch (e) {
          await api(
            `${prefix}/attachments/${data.attachmentId}`,
            "DELETE",
          ).catch(() => {});
          throw e;
        }
      }),
    downloadAttachment: (id: string) =>
      action(async () => {
        const win = window.open("about:blank", "_blank");
        try {
          const data = await api(`${path()}/attachments/${id}/download`);
          if (win) {
            win.opener = null;
            win.location.href = data.url;
          } else throw new Error("Allow popups to open this attachment.");
        } catch (e) {
          win?.close();
          throw e;
        }
      }),
    deleteAttachment: (id: string) =>
      action(async () => {
        await api(`${path()}/attachments/${id}`, "DELETE");
      }),
  };
}
