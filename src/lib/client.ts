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
import type { Attachment, Member, Note, Task, Workspace } from "./model";
import { prepareImage } from "./images";
import { assertNoteParent } from "./note-tree";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const configured = Object.values(config).every(Boolean);
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
type Preview = { tasks: Task[]; notes: Note[] };
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
  const preview = useRef<Preview>({ tasks: demoTasks, notes: [] });
  const ready = useRef(false);
  const report = useCallback((e: unknown) => {
    const message =
      e instanceof Error
        ? e.message
        : "Something went wrong. Please try again.";
    setError(message);
    return new Error(message);
  }, []);
  const api = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const auth = getAuth(getApps().length ? getApp() : initializeApp(config));
      if (!auth.currentUser) throw new Error("Sign in to continue.");
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
        throw new Error(
          data.error?.message ??
            "The request failed. Your draft has been kept.",
        );
      return data;
    },
    [],
  );
  const loadWorkspaces = useCallback(async () => {
    const data = await api("workspaces");
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
            if (!rows.length) setLoading(false);
          })
          .catch((e) => {
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
    const watch = <T>(name: string, set: (rows: T[]) => void) =>
      onSnapshot(
        collection(db, `workspaces/${workspace.id}/${name}`),
        (snapshot) => {
          set(
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
              ),
          );
          loaded.add(name);
          if (loaded.size >= 4) setLoading(false);
        },
        (e) => {
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
    return () => unsubs.forEach((unsub) => unsub());
  }, [workspace, user, report]);
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
    saveTask: (task: Partial<Task> & { title: string }) =>
      action(async () => {
        if (!configured) {
          const item = {
            description: "",
            status: "todo" as const,
            assigneeId: null,
            dueDate: null,
            position: preview.current.tasks.length,
            ...task,
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
          const item = {
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
