"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useTeamspace, DocumentPresence } from "./client";
import {
  CollaborationController,
  type CollaborationView,
} from "./collaboration-controller";
import { indexedRecoveryStore } from "./collaboration-store";
import type { NoteContent } from "./model";
import { decodeDocument, readContent } from "./collaboration-model";
import { linkableTypes } from "./linked-content";

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
  generationChanged: false,
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
    archiveRecovery: () => Promise<void>;
    retryRecovery: () => Promise<void>;
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
  const [archivedRecovery, setArchivedRecovery] = useState<{
    key: string;
    content: NoteContent | null;
  }>({ key: "", content: null });
  const [archiveError, setArchiveError] = useState({ key: "", message: "" });
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
    let archiving: Promise<void> | undefined;
    let retrying: Promise<void> | undefined;
    let stopped: Promise<void> | undefined;
    const stopController = () =>
      (stopped ??= instance?.dispose() ?? Promise.resolve());
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
      try {
        const archivedContent = (await store.archivedContent?.()) ?? null;
        if (cancelled) return;
        setArchivedRecovery({ key, content: archivedContent });
        setArchiveError({ key, message: "" });
      } catch {
        if (cancelled) return;
        // An unavailable archive must not prevent the live page from opening.
        // Retain any in-memory copy until its durable archive can be read again.
        setArchiveError({
          key,
          message:
            "Archived local recovery could not be read. Keep this browser’s data and retry synchronization; the live page is unaffected.",
        });
      }
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
      const archiveRecovery = () => {
        if (archiving) return archiving;
        if (retrying) return retrying;
        if (cancelled || !instance || controller.current?.instance !== instance)
          return Promise.resolve();
        const captured = instance;
        const view = captured.getSnapshot();
        const generation = captured.getRecoveryGeneration();
        if (!view.generationChanged || !view.pending || !generation)
          return Promise.resolve();
        const operation = async () => {
          try {
            if (!store.archiveGeneration || !store.archivedContent)
              throw new Error(
                "This browser cannot archive recovery safely. Download Markdown and retry.",
              );
            setState({
              key,
              view: {
                ...view,
                readOnly: true,
                status: "Syncing…",
                error: null,
              },
            });
            unsubscribeView?.();
            // Stop all writers and drain queued durability work before moving the journal.
            // The effect's writer lock stays held through this complete operation.
            if (!stopped) await captured.ensureRecoveryDurable();
            await stopController();
            await store.archiveGeneration(generation);
            if (cancelled || controller.current?.instance !== captured) return;
            // Archive commit is durable already. A subsequent read failure must not
            // cause a second move of an active journal which no longer exists.
            setArchivedRecovery({
              key,
              content: view.recoveryContent ?? view.content,
            });
            boundApi.restartSubscriptions();
            setRestart((value) => value + 1);
          } catch (error) {
            if (!cancelled && controller.current?.instance === captured)
              setState({
                key,
                view: {
                  ...view,
                  readOnly: true,
                  status: "Sync failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Recovery could not be archived. Your local work is retained; download Markdown and retry.",
                },
              });
          } finally {
            archiving = undefined;
          }
        };
        archiving = operation();
        return archiving;
      };
      const retryRecovery = () => {
        if (archiving) return archiving;
        if (retrying) return retrying;
        if (cancelled || !instance || controller.current?.instance !== instance)
          return Promise.resolve();
        const captured = instance;
        const view = captured.getSnapshot();
        const operation = async () => {
          try {
            // A failed IndexedDB save may leave the controller ahead of its journal.
            // Never rebuild that controller until its latest pending work is durable.
            if (view.pending && !stopped)
              await captured.ensureRecoveryDurable();
            if (cancelled || controller.current?.instance !== captured) return;
            boundApi.restartSubscriptions();
            setRestart((value) => value + 1);
          } catch (error) {
            if (!cancelled && controller.current?.instance === captured)
              setState({
                key,
                view: {
                  ...captured.getSnapshot(),
                  status: "Sync failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Local work could not be preserved. Download Markdown before leaving, then retry.",
                },
              });
          } finally {
            retrying = undefined;
          }
        };
        retrying = operation();
        return retrying;
      };
      controller.current = { key, instance, archiveRecovery, retryRecovery };
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
      const drained = stopController();
      if (controller.current?.instance === instance) controller.current = null;
      void Promise.all([
        drained,
        archiving ?? Promise.resolve(),
        retrying ?? Promise.resolve(),
      ]).finally(() => releaseLock?.());
      if (sessionId)
        void boundApi.leavePresence(noteId, sessionId).catch(() => {});
    };
  }, [enabled, noteId, uid, workspaceId, key, restart]);
  const view = state.key === key && enabled ? state.view : initialView;
  return useMemo(() => ({
    ...view,
    presence: enabled && presence.key === key ? presence.rows : [],
    archivedRecoveryContent:
      enabled && archivedRecovery.key === key ? archivedRecovery.content : null,
    archivedRecoveryError:
      enabled && archiveError.key === key ? archiveError.message : null,
    discardRecoveryAndRetry: () => {
      if (!enabled || controller.current?.key !== key) return Promise.resolve();
      return controller.current.archiveRecovery();
    },
    change: (next: NoteContent, base?: NoteContent) => {
      if (enabled && controller.current?.key === key)
        controller.current.instance.change(next, base);
    },
    changeChecked: (next: NoteContent, base?: NoteContent, requiredBlockId?: string) => {
      if (requiredBlockId && !controller.current?.instance.getSnapshot().content?.blocks.some(block => block.id === requiredBlockId && linkableTypes.has(block.type)))
        throw new Error("The original block was deleted or changed. Keep your text before reloading.");
      if (!enabled || controller.current?.key !== key || !controller.current.instance.change(next, base))
        throw new Error(controller.current?.instance.getSnapshot().error || "The source is not editable. Keep your text and retry synchronization.");
    },
    retry: () => {
      if (!enabled) return;
      if (controller.current?.key === key) {
        void controller.current.retryRecovery();
        return;
      }
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
  }), [view, enabled, presence, key, archivedRecovery, archiveError]);
}
