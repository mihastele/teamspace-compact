"use client";

import { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from "react";
import type { Block, Note, NoteContent } from "./model";
import {
  CollaborationController,
  type CollaborationView,
  type CollaborationTransport,
} from "./collaboration-controller";
import { indexedRecoveryStore, type RecoveryStore } from "./collaboration-store";
import {
  initializeDocument,
  encodeDocument,
  decodeDocument,
  readContent,
  tiptapDocToNoteContent,
  fromBase64,
  REMOTE_ORIGIN,
  safeUUID,
} from "./collaboration-model";
import { useTeamspace, type DocumentPresence } from "./client";
import * as Y from "yjs";

export type PageCollaborationState = {
  view: CollaborationView;
  presenceUsers: DocumentPresence[];
  applyTiptapChange: (tiptapDoc: unknown) => void;
  undo: () => void;
  redo: () => void;
  retry: () => void;
  noteContent: NoteContent | null;
};

/**
 * Hook bridging Tiptap editor and Teamspace page block to real-time CRDT collaboration.
 * Uses CollaborationController + IndexedDB RecoveryStore + BroadcastChannel cross-tab sync.
 */
export function usePageCollaboration(block: Block, api: ReturnType<typeof useTeamspace>): PageCollaborationState {
  const [controller, setController] = useState<CollaborationController | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<DocumentPresence[]>([]);
  const controllerRef = useRef<CollaborationController | null>(null);

  // In-memory fallback doc for initial mount before controller is ready
  const [initialContent] = useState<NoteContent>(() =>
    tiptapDocToNoteContent(block.content || { type: "doc", content: [{ type: "paragraph" }] })
  );

  // Set up collaboration controller on block or user change
  useEffect(() => {
    let active = true;
    let cleanupTransport: (() => void) | undefined;
    let channel: BroadcastChannel | null = null;

    const scope = `${api.user?.uid || "local"}:${block.workspaceId}:${block.id}`;
    let store: RecoveryStore;
    try {
      store = indexedRecoveryStore(scope);
    } catch {
      store = {
        async load() { return null; },
        async save() {},
      };
    }

    // Prepare initial Note object for CollaborationController
    const initialContent = tiptapDocToNoteContent(
      block.content || { type: "doc", content: [{ type: "paragraph" }] }
    );
    const initialDoc = initializeDocument(initialContent);
    const initialNote: Note = {
      id: block.id,
      parentId: block.parentId,
      title: block.title,
      content: initialContent,
      revision: block.revision || 1,
      collab: {
        version: 1,
        generation: safeUUID(),
        state: encodeDocument(initialDoc),
        sequence: 0,
      },
    };
    initialDoc.destroy();

    // Configure Transport: backend API if configured, signed-in & workspace selected, else cross-tab BroadcastChannel
    let transport: CollaborationTransport;
    const isServerCollab = Boolean(api.configured && api.user && api.workspace);

    if (isServerCollab) {
      transport = {
        subscribe(next, fail) {
          return api.subscribeCollaboration(block.id, next, fail);
        },
        async send(packet) {
          return api.sendNoteUpdate(block.id, packet);
        },
      };
    } else {
      // Local preview / offline mode: cross-tab BroadcastChannel
      const channelName = `teamspace_collab_${block.id}`;
      channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
      let localNote = { ...initialNote };

      transport = {
        subscribe(next) {
          if (!channel) return () => {};
          const onMessage = (event: MessageEvent) => {
            if (event.data?.type === "update" && event.data?.note) {
              localNote = event.data.note;
              next(localNote);
            }
          };
          channel.addEventListener("message", onMessage);
          return () => channel?.removeEventListener("message", onMessage);
        },
        async send(packet) {
          const doc = decodeDocument(localNote.collab!.state);
          try {
            Y.applyUpdate(doc, fromBase64(packet.update), REMOTE_ORIGIN);
            const nextContent = readContent(doc);
            localNote = {
              ...localNote,
              content: nextContent,
              revision: localNote.revision + 1,
              collab: {
                ...localNote.collab!,
                state: encodeDocument(doc),
                sequence: localNote.collab!.sequence + 1,
              },
            };
            channel?.postMessage({ type: "update", note: localNote });
            return localNote;
          } finally {
            doc.destroy();
          }
        },
      };
    }

    const newController = new CollaborationController(initialNote, transport, store);
    controllerRef.current = newController;

    newController.start().then(() => {
      if (!active) {
        newController.dispose();
        return;
      }
      setController(newController);
    });

    // Cross-tab / Server presence
    const sessionId = safeUUID();
    let presenceCleanup: (() => void) | undefined;

    if (isServerCollab) {
      api.heartbeatPresence(block.id, sessionId).catch(() => {});
      const interval = setInterval(() => {
        api.heartbeatPresence(block.id, sessionId).catch(() => {});
      }, 45000);

      presenceCleanup = api.subscribePresence(
        block.id,
        (users) => {
          if (active) setPresenceUsers(users);
        },
        () => {}
      );

      cleanupTransport = () => {
        clearInterval(interval);
        api.leavePresence(block.id, sessionId).catch(() => {});
        presenceCleanup?.();
      };
    } else if (channel) {
      // Preview presence over BroadcastChannel
      const currentPresence: DocumentPresence = {
        id: sessionId,
        uid: api.user?.uid || "preview-user",
        displayName: "You",
        expiresAt: Date.now() + 60000,
      };
      channel.postMessage({ type: "presence_join", user: currentPresence });

      const onPresenceMessage = (e: MessageEvent) => {
        if (!active) return;
        if (e.data?.type === "presence_join" && e.data?.user) {
          setPresenceUsers((prev) => {
            const next = prev.filter((p) => p.id !== e.data.user.id);
            return [...next, e.data.user];
          });
        } else if (e.data?.type === "presence_leave" && e.data?.sessionId) {
          setPresenceUsers((prev) => prev.filter((p) => p.id !== e.data.sessionId));
        }
      };
      channel.addEventListener("message", onPresenceMessage);

      cleanupTransport = () => {
        channel?.postMessage({ type: "presence_leave", sessionId });
        channel?.removeEventListener("message", onPresenceMessage);
        channel?.close();
      };
    }

    return () => {
      active = false;
      controllerRef.current = null;
      newController.dispose();
      cleanupTransport?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.workspaceId, api.user?.uid, api.workspace?.id, api.configured]);

  // Subscribe to controller view state
  const emptyView: CollaborationView = useMemo(
    () => ({
      content: initialContent,
      status: "Saved",
      error: null,
      pending: false,
      ready: true,
      canUndo: false,
      canRedo: false,
      readOnly: false,
      recoveryContent: null,
      generationChanged: false,
    }),
    [initialContent]
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!controller) return () => {};
      return controller.subscribe(listener);
    },
    [controller]
  );

  const getSnapshot = useCallback(
    () => controller?.getSnapshot() || emptyView,
    [controller, emptyView]
  );

  const getServerSnapshot = useCallback(() => emptyView, [emptyView]);

  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const applyTiptapChange = useCallback(
    (tiptapDoc: unknown) => {
      if (!controller) return;
      const nextContent = tiptapDocToNoteContent(tiptapDoc);
      controller.change(nextContent);
    },
    [controller]
  );

  const undo = useCallback(() => controller?.undo(), [controller]);
  const redo = useCallback(() => controller?.redo(), [controller]);
  const retry = useCallback(() => controller?.retry(), [controller]);

  return {
    view,
    presenceUsers,
    applyTiptapChange,
    undo,
    redo,
    retry,
    noteContent: view.content || initialContent,
  };
}
