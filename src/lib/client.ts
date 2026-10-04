"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserConfigured as configured,
  browserProvider,
  currentBrowserUser,
  browserAccessToken,
  observeBrowserAuth,
  loadAuthConfiguration,
  browserSignIn,
  browserRegister,
  browserGoogleSignIn,
  browserSignOut,
  browserResendConfirmation,
  browserRefreshConfirmation,
  browserResetPassword,
  browserCompletePasswordReset,
  subscribeBrowserCollection,
  timestampMillis,
  type BrowserUser,
  type AuthConfiguration,
} from "./browser-backend";
export { browserConfigurationStatus } from "./browser-backend";
import { buildInviteUrl, resolveAppBaseUrl } from "./app-url";
import type {
  Attachment,
  Member,
  Note,
  Task,
  Workspace,
  PageVersion,
  PageVersionSummary,
  ConversationComment,
} from "./model";
import {
  commentWindow,
  postPreviewComment,
  deletePreviewComment,
  type PreviewComment,
  type ConversationParent,
  type CommentPacket,
} from "./conversations";
import {
  checkpointLocalPage,
  nameLocalVersion,
  restoreLocalPage,
  visibleVersions,
  reconcilePageSnapshots,
  type LocalPageHistory,
} from "./page-history";
import { prepareImage } from "./images";
import { assertNoteParent } from "./note-tree";
import { updateTaskStatus } from "./task-status";
import { terminalSnapshotReadFailure } from "./browser-sync";

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
type Preview = {
  tasks: Task[];
  notes: Note[];
  histories?: Record<string, LocalPageHistory>;
  conversations?: Record<string, PreviewComment[]>;
};
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
  const [user, setUser] = useState<BrowserUser | null>(null);
  const [authConfiguration, setAuthConfiguration] =
    useState<AuthConfiguration | null>(null);
  const [authConfigurationError, setAuthConfigurationError] = useState<
    string | null
  >(null);
  const [authConfigurationLoading, setAuthConfigurationLoading] =
    useState(configured);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [rootAccount, setRootAccount] = useState<string | null>(null);
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
  const commentObservers = useRef(
    new Set<{
      parentType: ConversationParent;
      parentId: string;
      next: (rows: ConversationComment[]) => void;
      fail: (error: Error) => void;
    }>(),
  );
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
  const notifyPreviewComments = useCallback(() => {
    for (const observer of commentObservers.current) {
      const parents =
        observer.parentType === "note"
          ? preview.current.notes
          : preview.current.tasks;
      if (!parents.some((item) => item.id === observer.parentId))
        observer.fail(
          new Error(
            "This page or task was removed. Your message draft is kept locally.",
          ),
        );
      else
        observer.next(
          commentWindow(
            preview.current.conversations?.[
              `${observer.parentType}:${observer.parentId}`
            ] ?? [],
          ),
        );
    }
  }, []);
  const api = useCallback(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      expectedUid?: string,
    ) => {
      const current = currentBrowserUser();
      if (!current) throw new Error("Sign in to continue.");
      if (expectedUid && current.uid !== expectedUid)
        throw new RequestError(
          "The signed-in account changed. Reopen this document in the original account to recover its pending edits.",
          401,
          "account_changed",
        );
      const token = await browserAccessToken(expectedUid || current.uid);
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
    const expectedUid = currentBrowserUser()?.uid;
    const data = await api("workspaces", "GET", undefined, expectedUid);
    if (currentBrowserUser()?.uid !== expectedUid) return [] as Workspace[];
    setRootAccount(data.isRootAdmin ? expectedUid ?? null : null);
    setWorkspaces(data.workspaces);
    setWorkspace(
      (current) =>
        data.workspaces.find((w: Workspace) => w.id === current?.id) ??
        data.workspaces[0] ??
        null,
    );
    return data.workspaces as Workspace[];
  }, [api]);
  const accessUid = user?.uid;
  const loadAdministrationMembers = useCallback(async (workspaceId: string) => {
    if (!configured || !accessUid) return unavailable();
    const data = await api(`workspaces/${workspaceId}/members`, "GET", undefined, accessUid);
    return data.members as Member[];
  }, [api, accessUid]);
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
        notifyPreviewComments();
      });
      return () => {
        cancelled = true;
      };
    }
    return observeBrowserAuth((next, recovering) => {
      setUser(next);
      setRootAccount(null);
      setPasswordRecovery(recovering);
      setTasks([]);
      setNotes([]);
      setMembers([]);
      setAttachments([]);
      setWorkspace(null);
      setWorkspaces([]);
      setLoading(Boolean(next));
    }, report);
  }, [loadWorkspaces, report, notifyPreviewComments]);
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void loadAuthConfiguration()
      .then((value) => {
        if (cancelled) return;
        setAuthConfiguration(value);
        setAuthConfigurationError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthConfiguration(null);
          setAuthConfigurationError(
            error instanceof Error
              ? error.message
              : "Authentication configuration failed.",
          );
          setLoading(false);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthConfigurationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authEpoch]);
  useEffect(() => {
    if (!configured || !user || !authConfiguration) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      if (
        passwordRecovery ||
        (authConfiguration.emailConfirmationRequired && !user.emailVerified)
      ) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        await api("access/bootstrap", "POST", {}, user.uid);
        if (cancelled || currentBrowserUser()?.uid !== user.uid) return;
        const rows = await loadWorkspaces();
        if (
          !cancelled &&
          currentBrowserUser()?.uid === user.uid &&
          !rows.length
        )
          setLoading(false);
      } catch (error) {
        if (!cancelled && currentBrowserUser()?.uid === user.uid) {
          report(error);
          setLoading(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, authConfiguration, passwordRecovery, loadWorkspaces, report, api]);
  useEffect(() => {
    if (!configured || !user || !workspace) return;
    const loaded = new Set<string>();
    let active = true;
    const watch = <T>(name: string, set: (rows: T[]) => void) =>
      subscribeBrowserCollection(
        `workspaces/${workspace.id}/${name}`,
        (snapshot) => {
          if (!active) return;
          let rows = snapshot
            .filter(
              (doc) =>
                name !== "attachments" ||
                ["ready", "deleting"].includes(doc.status as string),
            )
            .map(
              (doc) =>
                ({
                  ...doc,
                  ...(name === "notes"
                    ? { parentId: doc.parentId ?? null }
                    : {}),
                  id: doc.id,
                }) as T,
            );
          if (name === "notes") {
            rows = reconcilePageSnapshots(
              noteSnapshot.current?.workspaceId === workspace.id
                ? noteSnapshot.current.rows
                : [],
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
              if (
                document &&
                !(document as Note & { deleting?: boolean }).deleting
              )
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
          const terminal = browserProvider === "firebase" || terminalSnapshotReadFailure(e);
          if (terminal && name === "notes")
            for (const observer of noteObservers.current)
              if (observer.workspaceId === workspace.id) observer.fail(e);
          report(e);
          setLoading(false);
          if (terminal) set([]);
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
    notifyPreviewComments();
  }
  function hasPreviewParent(type: ConversationParent, id: string) {
    return (
      type === "note" ? preview.current.notes : preview.current.tasks
    ).some((item) => item.id === id);
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
      "This needs a configured shared backend. Local preview has no shared access or file storage.",
    );
  }
  return {
    configured,
    provider: browserProvider,
    authConfiguration,
    authConfigurationLoading,
    authConfigurationError,
    passwordRecovery,
    needsEmailConfirmation: Boolean(
      user &&
      authConfiguration?.emailConfirmationRequired &&
      !user.emailVerified,
    ),
    retryAuthConfiguration: () => {
      setAuthConfigurationLoading(true);
      setAuthEpoch((epoch) => epoch + 1);
    },
    user: user
      ? {
          uid: user.uid,
          displayName: user.displayName ?? "Teammate",
          email: user.email,
          emailVerified: user.emailVerified,
        }
      : null,
    loading,
    error,
    workspace,
    workspaces,
    tasks: tasks.toSorted((a, b) => a.position - b.position),
    notes,
    members,
    isRootAdmin: Boolean(user && rootAccount === user.uid),
    refreshWorkspaces: () => action(async () => { await loadWorkspaces(); }),
    listAdministrationWorkspaces: async () => {
      if (!configured || !user) return unavailable();
      return await api("administration/workspaces", "GET", undefined, user.uid) as { workspaces: Workspace[]; truncated: boolean };
    },
    listAdministrationMembers: loadAdministrationMembers,
    addWorkspaceMember: async (workspaceId: string, account: string, operationId: string) => {
      if (!configured || !user) return unavailable();
      return await api(`workspaces/${workspaceId}/members`, "POST", { account, operationId }, user.uid) as { uid: string; removed: boolean; alreadyMember: boolean };
    },
    setAdministrationRole: async (workspaceId: string, uid: string, role: "admin" | "member") => {
      if (!configured || !user) return unavailable();
      await api(`workspaces/${workspaceId}/members/${uid}`, "PATCH", { role }, user.uid);
    },
    removeAdministrationMember: async (workspaceId: string, uid: string) => {
      if (!configured || !user) return unavailable();
      await api(`workspaces/${workspaceId}/members/${uid}`, "DELETE", undefined, user.uid);
    },
    attachments,
    subscribeComments: (
      parentType: ConversationParent,
      parentId: string,
      next: (rows: ConversationComment[]) => void,
      fail: (error: Error) => void,
    ) => {
      let active = true;
      if (!configured) {
        const observer = { parentType, parentId, next, fail };
        commentObservers.current.add(observer);
        queueMicrotask(() => {
          if (active && ready.current) notifyPreviewComments();
        });
        return () => {
          active = false;
          commentObservers.current.delete(observer);
        };
      }
      if (!user) throw new Error("Sign in to open a conversation.");
      const boundUid = user.uid;
      const un = subscribeBrowserCollection(
        `${path()}/${parentType === "note" ? "notes" : "tasks"}/${parentId}/comments`,
        (snapshot) => {
          if (!active || currentBrowserUser()?.uid !== boundUid) return;
          next(
            commentWindow(
              snapshot.map(
                (value) =>
                  ({
                    ...value,
                    createdAt: timestampMillis(value.createdAt),
                    deleted: value.deleted === true,
                    mentions: value.mentions ?? [],
                  }) as ConversationComment,
              ),
            ),
          );
        },
        (error) => {
          if (active && currentBrowserUser()?.uid === boundUid) fail(error);
        },
        true,
      );
      return () => {
        active = false;
        un();
      };
    },
    postComment: async (
      parentType: ConversationParent,
      parentId: string,
      packet: CommentPacket,
    ): Promise<ConversationComment> => {
      if (!configured) {
        if (!hasPreviewParent(parentType, parentId))
          throw new Error("This page or task no longer exists.");
        const key = `${parentType}:${parentId}`;
        // Hashing yields asynchronously; serialize preview comment writes against latest state.
        const rows = await postPreviewComment(
          preview.current.conversations?.[key] ?? [],
          packet,
          members,
          Date.now(),
        );
        if (!hasPreviewParent(parentType, parentId))
          throw new Error("This page or task no longer exists.");
        const current = preview.current.conversations?.[key] ?? [];
        const appended = rows.find(
          (item) => item.operationId === packet.operationId,
        )!;
        const duplicate = current.find(
          (item) => item.operationId === packet.operationId,
        );
        if (duplicate && duplicate.digest !== appended.digest)
          throw new Error("A message request identity cannot be reused.");
        const merged = duplicate ? current : [...current, appended];
        persist({
          ...preview.current,
          conversations: { ...preview.current.conversations, [key]: merged },
        });
        return duplicate ?? appended;
      }
      if (!user) throw new Error("Sign in to send a message.");
      const data = await api(
        `${path()}/${parentType === "note" ? "notes" : "tasks"}/${parentId}/comments`,
        "POST",
        packet,
        user.uid,
      );
      return data.comment as ConversationComment;
    },
    deleteComment: async (
      parentType: ConversationParent,
      parentId: string,
      commentId: string,
    ) => {
      if (!configured) {
        if (!hasPreviewParent(parentType, parentId))
          throw new Error("This page or task no longer exists.");
        const key = `${parentType}:${parentId}`;
        persist({
          ...preview.current,
          conversations: {
            ...preview.current.conversations,
            [key]: deletePreviewComment(
              preview.current.conversations?.[key] ?? [],
              commentId,
            ),
          },
        });
        return;
      }
      if (!user) throw new Error("Sign in to delete a message.");
      await api(
        `${path()}/${parentType === "note" ? "notes" : "tasks"}/${parentId}/comments/${commentId}`,
        "DELETE",
        undefined,
        user.uid,
      );
    },
    restartSubscriptions: () => setWatchEpoch((epoch) => epoch + 1),
    listPageHistory: async (noteId: string, before?: number) => {
      if (!configured) {
        if (!preview.current.notes.some((note) => note.id === noteId))
          throw new Error("The page no longer exists.");
        const rows = visibleVersions(
          preview.current.histories?.[noteId],
          Date.now(),
        ).filter(
          (version) => before === undefined || version.sourceRevision < before,
        );
        return {
          versions: rows.slice(0, 20).map(({ content, ...summary }) => {
            void content;
            return summary;
          }),
          nextBefore: rows.length > 20 ? rows[19].sourceRevision : null,
        };
      }
      return (await api(
        `${path()}/notes/${noteId}/history${before === undefined ? "" : `?before=${before}`}`,
        "GET",
        undefined,
        user?.uid,
      )) as { versions: PageVersionSummary[]; nextBefore: number | null };
    },
    getPageVersion: async (
      noteId: string,
      versionId: string,
    ): Promise<PageVersion> => {
      if (!configured) {
        if (!preview.current.notes.some((note) => note.id === noteId))
          throw new Error("The page no longer exists.");
        const version = visibleVersions(
          preview.current.histories?.[noteId],
          Date.now(),
        ).find((item) => item.id === versionId);
        if (!version) throw new Error("This version is missing or expired.");
        return structuredClone(version);
      }
      const data = await api(
        `${path()}/notes/${noteId}/history?version=${encodeURIComponent(versionId)}`,
        "GET",
        undefined,
        user?.uid,
      );
      return data.version as PageVersion;
    },
    savePageVersion: async (
      noteId: string,
      expectedRevision: number,
      name: string,
    ): Promise<PageVersion> => {
      if (!configured) {
        const note = preview.current.notes.find((item) => item.id === noteId);
        if (!note) throw new Error("The page no longer exists.");
        const history = nameLocalVersion(
          preview.current.histories?.[noteId],
          note,
          expectedRevision,
          name,
          Date.now(),
        );
        persist({
          ...preview.current,
          histories: { ...preview.current.histories, [noteId]: history },
        });
        return structuredClone(
          history.versions.find(
            (version) => version.sourceRevision === expectedRevision,
          )!,
        );
      }
      const data = await api(
        `${path()}/notes/${noteId}/history`,
        "POST",
        { expectedRevision, name },
        user?.uid,
      );
      const full = await api(
        `${path()}/notes/${noteId}/history?version=${encodeURIComponent(data.versionId)}`,
        "GET",
        undefined,
        user?.uid,
      );
      return full.version as PageVersion;
    },
    restorePageVersion: async (
      noteId: string,
      versionId: string,
      expectedRevision: number,
      operationId: string,
    ): Promise<Note> => {
      if (!configured) {
        const note = preview.current.notes.find((item) => item.id === noteId);
        if (!note) throw new Error("The page no longer exists.");
        const restored = restoreLocalPage(
          preview.current.histories?.[noteId],
          note,
          versionId,
          expectedRevision,
          operationId,
          Date.now(),
        );
        persist({
          ...preview.current,
          notes: preview.current.notes.map((item) =>
            item.id === noteId ? restored.note : item,
          ),
          histories: {
            ...preview.current.histories,
            [noteId]: restored.history,
          },
        });
        return restored.note;
      }
      const boundWorkspace = workspace?.id;
      const boundUid = user?.uid;
      const data = await api(
        `${path()}/notes/${noteId}/restore`,
        "POST",
        { versionId, expectedRevision, operationId },
        boundUid,
      );
      const note = data.note as Note;
      const current = noteSnapshot.current;
      if (
        current &&
        currentBrowserUser()?.uid === boundUid &&
        current.workspaceId === boundWorkspace
      ) {
        const rows = current.rows.map((item) =>
          item.id === noteId && note.revision > item.revision ? note : item,
        );
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
      let active = true;
      const unsubscribe = subscribeBrowserCollection(
        `${path()}/notes/${noteId}/presence`,
        (snapshot) => {
          if (!active) return;
          next(
            snapshot.map((document) => ({
              ...document,
              expiresAt: timestampMillis(document.expiresAt),
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
        if (!authConfiguration?.googleAuthEnabled)
          throw new Error("Google sign-in is disabled for this deployment.");
        await browserGoogleSignIn();
      }),
    signInEmail: (email: string, password: string) =>
      action(async () => {
        if (!authConfiguration?.passwordAuthEnabled)
          throw new Error("Email sign-in is disabled for this deployment.");
        await browserSignIn(email, password);
      }),
    registerEmail: (email: string, password: string, displayName: string) =>
      action(async () => {
        if (!authConfiguration?.passwordAuthEnabled)
          throw new Error(
            "Email registration is disabled for this deployment.",
          );
        return await browserRegister(
          email,
          password,
          displayName,
          authConfiguration.emailConfirmationRequired,
        );
      }),
    resendConfirmation: (email: string) =>
      action(() => browserResendConfirmation(email)),
    refreshConfirmation: () => action(() => browserRefreshConfirmation()),
    resetPassword: (email: string) => action(() => browserResetPassword(email)),
    completePasswordReset: (password: string, code?: string) =>
      action(() => browserCompletePasswordReset(password, code)),
    signOut: () => action(() => browserSignOut()),
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
            conversations: Object.fromEntries(
              Object.entries(preview.current.conversations ?? {}).filter(
                ([key]) => key !== `task:${id}`,
              ),
            ),
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
            histories: {
              ...preview.current.histories,
              [item.id]: checkpointLocalPage(
                preview.current.histories?.[item.id],
                item,
                Date.now(),
              ),
            },
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
            histories: Object.fromEntries(
              Object.entries(preview.current.histories ?? {}).filter(
                ([noteId]) => noteId !== id,
              ),
            ),
            conversations: Object.fromEntries(
              Object.entries(preview.current.conversations ?? {}).filter(
                ([key]) => key !== `note:${id}`,
              ),
            ),
          });
          return;
        }
        await api(`${path()}/notes/${id}`, "DELETE");
      }),
    createInvite: () =>
      action(async () => {
        if (!configured) return unavailable();
        const data = await api(`${path()}/invites`, "POST", {});
        if (typeof data.inviteUrl === "string" && data.inviteUrl) {
          return data.inviteUrl as string;
        }
        return buildInviteUrl(data.token, resolveAppBaseUrl());
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
    changeMemberRole: (uid: string, role: "admin" | "member") =>
      action(async () => {
        if (!configured || !user) return unavailable();
        await api(`${path()}/members/${uid}`, "PATCH", { role }, user.uid);
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
