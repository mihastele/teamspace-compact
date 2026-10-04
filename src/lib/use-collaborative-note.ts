"use client";

import { useEffect, useRef, useState } from "react";
import type { useTeamspace, DocumentPresence } from "./client";
import {
  CollaborationController,
  type CollaborationView,
} from "./collaboration-controller";
import { indexedRecoveryStore } from "./collaboration-store";
import type { NoteContent } from "./model";
import { decodeDocument, readContent } from "./collaboration-model";

type Api = ReturnType<typeof useTeamspace>;
const initialView: CollaborationView = {
  content: null,
  status: "Syncing…",
  error: null,
  pending: false,
  ready: false,
  canUndo: false,
  canRedo: false,
  readOnly: true,
  recoveryContent: null,
};

export function useCollaborativeNote({
  api,
  noteId,
  enabled,
}: {
  api: Api;
  noteId: string | null;
  enabled: boolean;
}) {
  const uid = api.user?.uid;
  const workspaceId = api.workspace?.id;
  const apiRef = useRef(api);
  const controller = useRef<{
    key: string;
    instance: CollaborationController;
  } | null>(null);
  const [state, setState] = useState<{ key: string; view: CollaborationView }>({
    key: "",
    view: initialView,
  });
  const [presence, setPresence] = useState<{
    key: string;
    rows: DocumentPresence[];
  }>({ key: "", rows: [] });
  const [restart, setRestart] = useState(0);
  const key = `${uid}:${workspaceId}:${noteId}`;
  useEffect(() => {
    apiRef.current = api;
  });
  useEffect(() => {
    if (!enabled || !noteId || !uid || !workspaceId) return;
    const boundApi = apiRef.current;
    let cancelled = false;
    let instance: CollaborationController | undefined;
    let unsubscribeView: (() => void) | undefined;
    let unsubscribePresence: (() => void) | undefined;
    let presenceTimer: ReturnType<typeof setInterval> | undefined;
    let expiryTimer: ReturnType<typeof setInterval> | undefined;
    let rows: DocumentPresence[] = [];
    let releaseLock: (() => void) | undefined;
    let sessionId: string | undefined;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const connectivity = () => {
      instance?.setOnline(navigator.onLine);
      if (navigator.onLine) void heartbeat();
    };
    const showPresence = () => {
      if (!cancelled)
        setPresence({
          key,
          rows: rows.filter((row) => row.expiresAt > Date.now()),
        });
    };
    async function heartbeat() {
      if (cancelled || !sessionId || !navigator.onLine) return;
      try {
        await boundApi.heartbeatPresence(noteId!, sessionId);
      } catch {
        if (process.env.NODE_ENV === "development")
          console.warn("Teamspace presence heartbeat failed");
      }
    }
    async function open() {
      if (cancelled) return;
      const scope = `${uid}:${workspaceId}:${noteId}:${sessionId}`;
      const store = indexedRecoveryStore(scope);
      let note;
      try {
        note = await boundApi.initializeCollaboration(noteId!);
      } catch (error) {
        if (cancelled) return;
        const recovery = await store.load();
        if (!cancelled && recovery?.pending.length) {
          const doc = decodeDocument(recovery.state);
          try {
            setState({
              key,
              view: {
                ...initialView,
                content: readContent(doc),
                ready: true,
                pending: true,
                status: "Sync failed",
                error: `${error instanceof Error ? error.message : "The document is unavailable."} Preserved local work can be downloaded as Markdown.`,
              },
            });
          } finally {
            doc.destroy();
          }
          return;
        }
        throw error;
      }
      if (cancelled) return;
      instance = new CollaborationController(
        note,
        {
          subscribe: (next, fail) =>
            boundApi.subscribeCollaboration(noteId!, next, fail),
          send: (packet) => boundApi.sendNoteUpdate(noteId!, packet),
        },
        store,
      );
      controller.current = { key, instance };
      unsubscribeView = instance.subscribe(() => {
        if (!cancelled) setState({ key, view: instance!.getSnapshot() });
      });
      instance.setOnline(navigator.onLine);
      await instance.start();
      if (cancelled) return;
      unsubscribePresence = boundApi.subscribePresence(
        noteId!,
        (next) => {
          rows = next;
          showPresence();
        },
        () => {
          rows = [];
          showPresence();
        },
      );
      presenceTimer = setInterval(() => {
        void heartbeat();
      }, 45000);
      expiryTimer = setInterval(showPresence, 15000);
      window.addEventListener("online", connectivity);
      window.addEventListener("offline", connectivity);
      void heartbeat();
    }
    async function start() {
      try {
        if (!navigator.locks)
          throw new Error(
            "This browser cannot safely lock recovery storage. Use a current browser with Web Locks support.",
          );
        const storageKey = `teamspace-outbox-session:${uid}:${workspaceId}:${noteId}`;
        sessionId = sessionStorage.getItem(storageKey) || crypto.randomUUID();
        sessionStorage.setItem(storageKey, sessionId);
        await navigator.locks.request(
          `teamspace-recovery:${key}:${sessionId}`,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (lock) {
              await open();
              await release;
            } else {
              // Duplicated tabs can inherit sessionStorage; never share their writer.
              sessionId = crypto.randomUUID();
              sessionStorage.setItem(storageKey, sessionId);
              await navigator.locks.request(
                `teamspace-recovery:${key}:${sessionId}`,
                async () => {
                  if (!cancelled) {
                    await open();
                    await release;
                  }
                },
              );
            }
          },
        );
      } catch (error) {
        if (!cancelled)
          setState({
            key,
            view: {
              ...initialView,
              status: "Sync failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Collaboration could not start. Retry when connected.",
            },
          });
      }
    }
    void start();
    return () => {
      cancelled = true;
      unsubscribeView?.();
      unsubscribePresence?.();
      if (presenceTimer) clearInterval(presenceTimer);
      if (expiryTimer) clearInterval(expiryTimer);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      const stopped = instance?.dispose() ?? Promise.resolve();
      if (controller.current?.instance === instance) controller.current = null;
      void stopped.finally(() => releaseLock?.());
      if (sessionId)
        void boundApi.leavePresence(noteId, sessionId).catch(() => {});
    };
  }, [enabled, noteId, uid, workspaceId, key, restart]);
  const view = state.key === key && enabled ? state.view : initialView;
  return {
    ...view,
    presence: enabled && presence.key === key ? presence.rows : [],
    change: (next: NoteContent, base?: NoteContent) => {
      if (enabled && controller.current?.key === key)
        controller.current.instance.change(next, base);
    },
    retry: () => {
      if (!enabled) return;
      apiRef.current.restartSubscriptions();
      setRestart((value) => value + 1);
    },
    undo: () => {
      if (enabled && controller.current?.key === key)
        controller.current.instance.undo();
    },
    redo: () => {
      if (enabled && controller.current?.key === key)
        controller.current.instance.redo();
    },
  };
}
