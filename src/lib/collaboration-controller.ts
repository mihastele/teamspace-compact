import * as Y from "yjs";
import type { Note, NoteContent } from "./model";
import {
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  applyEditorContent,
  decodeDocument,
  encodeDocument,
  readContent,
  fromBase64,
  toBase64,
  getTextTypes,
  validateDocument,
  MAX_UPDATE_BYTES,
} from "./collaboration-model";
import type { PendingUpdate, RecoveryStore } from "./collaboration-store";

export type SyncStatus =
  "Syncing…" | "Saving…" | "Saved" | "Offline" | "Sync failed";
export type CollaborationView = {
  content: NoteContent | null;
  status: SyncStatus;
  error: string | null;
  pending: boolean;
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
  recoveryContent: NoteContent | null;
};
export interface CollaborationTransport {
  subscribe(
    next: (note: Note) => void,
    fail: (error: Error) => void,
  ): () => void;
  send(packet: {
    operationId: string;
    generation: string;
    update: string;
  }): Promise<Note>;
}

/** The outbox owns local mutations; snapshots are reconciliation only. */
export class CollaborationController {
  private doc: Y.Doc;
  private undoManager: Y.UndoManager;
  private pending: PendingUpdate[] = [];
  private sequence: number;
  private generation: string;
  private disposed = false;
  private ready = false;
  private online = true;
  private blocked = false;
  private error: string | null = null;
  private writing = false;
  private durable = false;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private baselines = new WeakMap<NoteContent, string>();
  private view: CollaborationView;
  private failures = 0;
  private lastSend = 0;
  private recoveryContent: NoteContent | null = null;
  private bufferedUndo: Uint8Array[] | null = null;
  constructor(
    private initial: Note,
    private transport: CollaborationTransport,
    private store: RecoveryStore,
  ) {
    if (!initial.collab)
      throw new Error("Document has not been initialized for collaboration.");
    this.doc = decodeDocument(initial.collab.state);
    this.sequence = initial.collab.sequence;
    this.generation = initial.collab.generation;
    this.undoManager = new Y.UndoManager(getTextTypes(this.doc), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 750,
    });
    this.view = {
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
  }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    if (this.disposed) return;
    const content = readContent(this.doc);
    this.baselines.set(content, encodeDocument(this.doc));
    this.view = {
      content,
      ready: this.ready,
      pending: !!this.pending.length || !this.durable || !!this.recoveryContent,
      error: this.error,
      status: this.error
        ? "Sync failed"
        : !this.online
          ? "Offline"
          : !this.ready
            ? "Syncing…"
            : this.pending.length || !this.durable
              ? "Saving…"
              : "Saved",
      canUndo: !!this.undoManager.undoStack.length,
      canRedo: !!this.undoManager.redoStack.length,
      readOnly: !this.ready || this.blocked,
      recoveryContent: this.recoveryContent,
    };
    this.listeners.forEach((listener) => listener());
  }
  private serialize(task: () => Promise<void>) {
    const next = this.chain.then(task);
    this.chain = next.catch(() => {});
    return next;
  }
  private async persist(pending = this.pending) {
    this.durable = false;
    const record = {
      version: 1 as const,
      generation: this.generation,
      state: encodeDocument(this.doc),
      sequence: this.sequence,
      pending: pending.map((packet) => ({ ...packet })),
    };
    await this.store.save(record);
    this.durable = true;
  }
  private fail(error: unknown, blocked = false) {
    if (this.disposed) return;
    this.error =
      error instanceof Error
        ? error.message
        : "Synchronization failed. Your local work has been kept.";
    this.blocked ||= blocked;
    if (process.env.NODE_ENV === "development")
      console.warn("Teamspace synchronization failure", {
        sequence: this.sequence,
        pending: this.pending.length,
        blocked: this.blocked,
      });
    this.publish();
  }
  async start() {
    try {
      const recovered = await this.store.load();
      if (this.disposed) return;
      if (recovered) {
        if (recovered.version !== 1 || !Array.isArray(recovered.pending))
          throw new Error(
            "Recovery data is invalid. Keep this browser's data for recovery.",
          );
        if (recovered.pending.length) {
          const recovery = decodeDocument(recovered.state);
          try {
            this.recoveryContent = readContent(recovery);
          } finally {
            recovery.destroy();
          }
        }
        if (recovered.generation !== this.generation) {
          if (recovered.pending.length)
            throw new Error(
              "This document generation changed. Pending edits cannot be applied to a different document; keep this browser's recovery data.",
            );
        } else {
          const recovery = decodeDocument(recovered.state);
          try {
            this.mergeValidated(Y.encodeStateAsUpdate(recovery), REMOTE_ORIGIN);
          } finally {
            recovery.destroy();
          }
          for (const packet of recovered.pending) {
            if (
              !/^[0-9a-f-]{36}$/.test(packet.operationId) ||
              typeof packet.sent !== "boolean" ||
              fromBase64(packet.update).byteLength > MAX_UPDATE_BYTES
            )
              throw new Error(
                "Recovery operation is invalid. Keep this browser's data for recovery.",
              );
          }
          this.pending = recovered.pending;
        }
      }
      this.doc.on("update", this.onUpdate);
      this.refreshUndoScope();
      await this.serialize(() => this.persist());
      if (this.disposed) return;
      this.ready = true;
      this.recoveryContent = null;
      this.unsubscribe = this.transport.subscribe(
        (note) => this.receive(note),
        (error) => this.fail(error, true),
      );
      this.publish();
      this.schedule();
    } catch (error) {
      this.fail(error, true);
    }
  }
  private refreshUndoScope() {
    this.undoManager.addToScope(getTextTypes(this.doc));
  }
  private mergeValidated(update: Uint8Array, origin: unknown) {
    const candidate = decodeDocument(encodeDocument(this.doc), { gc: false });
    try {
      Y.applyUpdate(candidate, update, REMOTE_ORIGIN);
      validateDocument(candidate, this.doc);
      const before = readContent(this.doc).blocks;
      const after = new Set(
        readContent(candidate).blocks.map((block) => block.id),
      );
      if (before.some((block) => !after.has(block.id)))
        this.undoManager.clear();
      Y.applyUpdate(this.doc, update, origin);
    } finally {
      candidate.destroy();
    }
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (this.disposed || origin === REMOTE_ORIGIN) return;
    if (origin !== LOCAL_ORIGIN && origin !== this.undoManager) return;
    if (this.bufferedUndo) {
      this.bufferedUndo.push(update);
      return;
    }
    const visible = new Set(
      readContent(this.doc).blocks.map((block) => block.id),
    );
    if (this.view.content?.blocks.some((block) => !visible.has(block.id)))
      this.undoManager.clear();
    this.pending.push({
      operationId: crypto.randomUUID(),
      update: toBase64(update),
      sent: false,
    });
    this.durable = false;
    this.refreshUndoScope();
    this.publish();
    void this.serialize(() => this.persist())
      .then(() => {
        this.publish();
        this.schedule();
      })
      .catch((error) => this.fail(error, true));
  };
  change = (next: NoteContent, base?: NoteContent) => {
    if (!this.ready || this.disposed || this.blocked) return;
    try {
      const current = readContent(this.doc);
      const captured = base && this.baselines.get(base);
      if (base && !captured)
        throw new Error(
          "The editor baseline belongs to a different session. Reopen the note before editing.",
        );
      if (
        base &&
        captured &&
        JSON.stringify(base) !== JSON.stringify(current)
      ) {
        // Generate intent against the actual rendered CRDT baseline, then merge.
        const branch = decodeDocument(captured);
        try {
          const vector = Y.encodeStateVector(branch);
          applyEditorContent(branch, base, next);
          this.mergeValidated(
            Y.encodeStateAsUpdate(branch, vector),
            LOCAL_ORIGIN,
          );
        } finally {
          branch.destroy();
        }
      } else applyEditorContent(this.doc, current, next);
    } catch (error) {
      this.fail(error);
    }
    this.refreshUndoScope();
    this.publish();
  };
  private travelHistory(direction: "undo" | "redo") {
    if (!this.ready || this.blocked || this.disposed) return;
    const checkpoint = encodeDocument(this.doc);
    this.bufferedUndo = [];
    try {
      this.undoManager[direction]();
      validateDocument(this.doc);
      const updates = this.bufferedUndo;
      this.bufferedUndo = null;
      for (const update of updates) this.onUpdate(update, LOCAL_ORIGIN);
      this.publish();
    } catch {
      // No update has entered the outbox. Restore the validated local checkpoint.
      this.bufferedUndo = null;
      this.doc.off("update", this.onUpdate);
      this.undoManager.destroy();
      this.doc.destroy();
      this.doc = decodeDocument(checkpoint);
      this.undoManager = new Y.UndoManager(getTextTypes(this.doc), {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
        captureTimeout: 750,
      });
      this.doc.on("update", this.onUpdate);
      this.fail(
        new Error(
          "That history action conflicts with the current document or its limits. Current work is unchanged; text history was cleared.",
        ),
      );
    }
  }
  undo = () => this.travelHistory("undo");
  redo = () => this.travelHistory("redo");
  receive(note: Note) {
    if (this.disposed) return;
    try {
      if (!note.collab && note.revision <= this.initial.revision) return;
      if (!note.collab || note.collab.generation !== this.generation)
        throw new Error(
          "The document generation changed. Export local work before reloading.",
        );
      if (note.collab.sequence <= this.sequence) return;
      this.mergeValidated(fromBase64(note.collab.state), REMOTE_ORIGIN);
      this.sequence = note.collab.sequence;
      this.refreshUndoScope();
      this.publish();
      void this.serialize(() => this.persist())
        .then(() => this.publish())
        .catch((error) => this.fail(error, true));
    } catch (error) {
      this.fail(error, true);
    }
  }
  setOnline(online: boolean) {
    this.online = online;
    if (online && !this.blocked) {
      this.error = null;
      this.schedule();
    }
    this.publish();
  }
  private schedule(delay = 1500) {
    if (
      this.disposed ||
      this.blocked ||
      !this.online ||
      !this.ready ||
      !this.pending.length ||
      this.writing ||
      this.timer
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.flush();
      },
      Math.max(delay, this.lastSend + 1500 - Date.now()),
    );
  }
  private async flush() {
    if (
      this.disposed ||
      this.blocked ||
      !this.online ||
      this.writing ||
      !this.pending.length
    )
      return;
    this.writing = true;
    let packet: PendingUpdate | undefined;
    try {
      await this.serialize(async () => {
        if (this.pending[0].sent) packet = this.pending[0];
        else {
          const count = this.pending.findIndex((item) => item.sent);
          const available = this.pending.slice(
            0,
            count < 0 ? this.pending.length : count,
          );
          const unsent: PendingUpdate[] = [];
          let merged: Uint8Array = new Uint8Array();
          for (const item of available) {
            const candidate = Y.mergeUpdates([
              ...unsent.map((entry) => fromBase64(entry.update)),
              fromBase64(item.update),
            ]);
            if (candidate.byteLength > MAX_UPDATE_BYTES) break;
            unsent.push(item);
            merged = candidate;
          }
          if (!unsent.length)
            throw new Error(
              "A pending update exceeds synchronization capacity. Export your work for recovery.",
            );
          packet = {
            operationId: unsent[0].operationId,
            update: toBase64(merged),
            sent: true,
          };
          this.pending.splice(0, unsent.length, packet);
        }
        await this.persist(); // Freeze exact retry identity and bytes before sending.
      });
      if (this.disposed || !packet) return;
      this.lastSend = Date.now();
      const note = await this.transport.send({
        operationId: packet.operationId,
        generation: this.generation,
        update: packet.update,
      });
      if (this.disposed) return;
      if (!note.collab || note.collab.generation !== this.generation)
        throw new Error(
          "Invalid document acknowledgement. Pending work is retained.",
        );
      const acknowledged = decodeDocument(note.collab.state);
      try {
        const before = encodeDocument(acknowledged);
        Y.applyUpdate(acknowledged, fromBase64(packet.update), REMOTE_ORIGIN);
        validateDocument(acknowledged);
        if (before !== encodeDocument(acknowledged))
          throw new Error(
            "The server did not acknowledge the pending update. Local work is retained.",
          );
      } finally {
        acknowledged.destroy();
      }
      this.receive(note);
      if (this.blocked)
        throw new Error(
          this.error ||
            "Remote reconciliation failed. Pending work is retained.",
        );
      await this.serialize(async () => {
        await this.persist(
          this.pending.filter(
            (item) => item.operationId !== packet!.operationId,
          ),
        );
        this.pending = this.pending.filter(
          (item) => item.operationId !== packet!.operationId,
        );
      });
      this.failures = 0;
      this.error = null;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const permanent =
        status !== undefined &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status);
      this.fail(error, permanent);
      this.failures += 1;
    } finally {
      this.writing = false;
      this.publish();
      this.schedule(
        this.failures
          ? Math.min(30000, 1500 * 2 ** Math.min(this.failures, 5))
          : 1500,
      );
    }
  }
  retry = () => {
    this.blocked = false;
    this.error = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.publish();
    this.schedule(0);
  };
  dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.doc.off("update", this.onUpdate);
    this.listeners.clear();
    // A journal writer keeps its Web Lock until all already-queued saves finish.
    return this.chain.then(() => {
      this.undoManager.destroy();
      this.doc.destroy();
    });
  }
}
