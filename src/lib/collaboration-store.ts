import type { NoteContent } from "./model";
export type PendingUpdate = {
  operationId: string;
  update: string;
  sent: boolean;
};
export type RecoveryRecord = {
  version: 1;
  generation: string;
  state: string;
  sequence: number;
  pending: PendingUpdate[];
  archived?: boolean;
  archivedAt?: number;
};
export type RecoveryArchive = { id: string; archivedAt: number; generation: string; pendingCount: number };
export type ArchiveCursor = Pick<RecoveryArchive, "id" | "archivedAt">;
export type ArchivePage = { archives: RecoveryArchive[]; next: ArchiveCursor | null };
export interface RecoveryStore {
  load(): Promise<RecoveryRecord | null>;
  save(record: RecoveryRecord): Promise<void>;
  archiveGeneration?(generation: string): Promise<void>;
  archivedContent?(): Promise<NoteContent | null>;
  listArchives?(before?: ArchiveCursor, limit?: number): Promise<ArchivePage>;
  readArchive?(id: string): Promise<NoteContent>;
}

/** Persisted by account/workspace/note; another signed-in account cannot replay it. */
export function indexedRecoveryStore(scope: string): RecoveryStore {
  let connection: Promise<IDBDatabase> | undefined;
  function database() {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("teamspace-collaboration-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("notes");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = undefined;
        reject(
          new Error(
            "Recovery storage could not open. Export your work before leaving.",
          ),
        );
      };
      request.onblocked = () =>
        reject(
          new Error(
            "Recovery storage is blocked by another tab. Close it and retry.",
          ),
        );
    });
    return connection;
  }
  return {
    async listArchives(before, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid archive page size.");
      const prefix = scope.slice(0, scope.lastIndexOf(":") + 1);
      if (before && (typeof before.id !== "string" || !before.id.startsWith(prefix) || !Number.isSafeInteger(before.archivedAt) || before.archivedAt < 0 || before.archivedAt > 8640000000000000)) throw new Error("Invalid archive cursor.");
      const db = await database();
      const archives = await new Promise<RecoveryArchive[]>((resolve, reject) => {
        const found: RecoveryArchive[] = [];
        const transaction = db.transaction("notes", "readonly");
        const request = transaction.objectStore("notes").openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const value = cursor.value as RecoveryRecord, id = String(cursor.key);
          if (!value || typeof value !== "object") { cursor.continue(); return; }
          const archivedAt = Number.isSafeInteger(value.archivedAt) && value.archivedAt! >= 0 && value.archivedAt! <= 8640000000000000 ? value.archivedAt! : 0;
          if (value.archived === true && (!before || archivedAt < before.archivedAt || (archivedAt === before.archivedAt && id < before.id))) {
            found.push({ id, archivedAt, generation: typeof value.generation === "string" ? value.generation : "Unknown", pendingCount: Array.isArray(value.pending) ? value.pending.length : 0 });
            found.sort((a, b) => b.archivedAt - a.archivedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
            if (found.length > limit + 1) found.pop();
          }
          cursor.continue();
        };
        transaction.oncomplete = () => resolve(found);
        transaction.onabort = transaction.onerror = () => reject(new Error("Archived recovery could not be listed. Stored data is unchanged."));
      });
      const page = archives.slice(0, limit), last = page.at(-1);
      return { archives: page, next: archives.length > limit && last ? { id: last.id, archivedAt: last.archivedAt } : null };
    },
    async readArchive(id) {
      const prefix = scope.slice(0, scope.lastIndexOf(":") + 1);
      if (typeof id !== "string" || !id.startsWith(prefix)) throw new Error("This archive belongs to a different account, workspace or page.");
      const db = await database();
      const record = await new Promise<RecoveryRecord | undefined>((resolve, reject) => {
        const transaction = db.transaction("notes", "readonly");
        const request = transaction.objectStore("notes").get(id);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(new Error("Archived recovery could not be read. Stored data is unchanged."));
      });
      if (!record?.archived) throw new Error("This archive is unavailable. No stored data was changed.");
      const doc = decodeDocument(record.state);
      try { return readContent(doc); } finally { doc.destroy(); }
    },
    async load() {
      const db = await database();
      let own = await new Promise<RecoveryRecord | null>((resolve, reject) => {
        const transaction = db.transaction("notes", "readonly");
        const request = transaction.objectStore("notes").get(scope);
        transaction.oncomplete = () =>
          resolve(request.result?.archived ? null : (request.result ?? null));
        transaction.onabort = () =>
          reject(new Error("Recovery storage could not be read."));
        transaction.onerror = () =>
          reject(new Error("Recovery storage could not be read."));
      });
      // Reclaim pending journals from closed tabs under the same writer locks.
      // An active tab keeps its own journal; closed-tab data is atomically moved.
      const prefix = scope.slice(0, scope.lastIndexOf(":") + 1);
      const records = await new Promise<
        { key: string; value: RecoveryRecord }[]
      >((resolve, reject) => {
        const found: { key: string; value: RecoveryRecord }[] = [];
        const transaction = db.transaction("notes", "readonly");
        const request = transaction
          .objectStore("notes")
          .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            found.push({ key: String(cursor.key), value: cursor.value });
            cursor.continue();
          }
        };
        transaction.oncomplete = () => resolve(found);
        transaction.onabort = () =>
          reject(new Error("Recovery journals could not be inspected."));
      });
      for (const record of records) {
        if (
          record.key === scope ||
          record.value.archived ||
          !record.value.pending?.length
        )
          continue;
        await navigator.locks.request(
          `teamspace-recovery:${record.key}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return;
            // Re-read after acquiring the lock: another tab may have drained it.
            const current = await new Promise<RecoveryRecord | undefined>(
              (resolve, reject) => {
                const transaction = db.transaction("notes", "readonly");
                const request = transaction
                  .objectStore("notes")
                  .get(record.key);
                transaction.oncomplete = () => resolve(request.result);
                transaction.onabort = () =>
                  reject(new Error("Recovery journal could not be read."));
              },
            );
            if (
              !current?.pending.length ||
              current.archived ||
              (own && own.generation !== current.generation)
            )
              return;
            let merged = current;
            if (own) {
              const doc = decodeDocument(own.state, { gc: false });
              try {
                Y.applyUpdate(doc, fromBase64(current.state), REMOTE_ORIGIN);
                validateDocument(doc);
                const packets = new Map<string, PendingUpdate>();
                for (const packet of [...own.pending, ...current.pending]) {
                  if (
                    packets.has(packet.operationId) &&
                    packets.get(packet.operationId)!.update !== packet.update
                  )
                    throw new Error(
                      "Recovery operation identity conflicts. Both journals have been retained.",
                    );
                  packets.set(packet.operationId, packet);
                }
                merged = {
                  ...own,
                  state: encodeDocument(doc),
                  sequence: Math.max(own.sequence, current.sequence),
                  pending: [...packets.values()],
                };
              } finally {
                doc.destroy();
              }
            }
            await new Promise<void>((resolve, reject) => {
              const transaction = db.transaction("notes", "readwrite");
              transaction.objectStore("notes").put(merged, scope);
              transaction.objectStore("notes").delete(record.key);
              transaction.oncomplete = () => resolve();
              transaction.onabort = () =>
                reject(
                  new Error(
                    "Pending work could not be recovered from a closed tab.",
                  ),
                );
              transaction.onerror = () =>
                reject(
                  new Error(
                    "Pending work could not be recovered from a closed tab.",
                  ),
                );
            });
            own = merged;
          },
        );
      }
      return own;
    },
    async save(record) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("notes", "readwrite");
        transaction.objectStore("notes").put(record, scope);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            new Error(
              "Recovery storage failed. Export your work before leaving.",
            ),
          );
        transaction.onerror = () =>
          reject(
            new Error(
              "Recovery storage failed. Export your work before leaving.",
            ),
          );
      });
    },
    async archiveGeneration(generation) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("notes", "readwrite");
        const notes = transaction.objectStore("notes");
        const request = notes.get(scope);
        const prefix = scope.slice(0, scope.lastIndexOf(":") + 1);
        const cursorRequest = notes.openCursor(
          IDBKeyRange.bound(prefix, `${prefix}\uffff`),
        );
        let value: RecoveryRecord | undefined;
        let scanned = false;
        let stamp = Date.now();
        const archive = () => {
          if (!scanned || !value) return;
          notes.put(
            { ...value, archived: true, archivedAt: stamp },
            `${scope}:archive:${crypto.randomUUID()}`,
          );
          notes.delete(scope);
        };
        request.onsuccess = () => {
          value = request.result as RecoveryRecord | undefined;
          if (!value || value.archived || value.generation !== generation) {
            transaction.abort();
            return;
          }
          archive();
        };
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            const record = cursor.value as RecoveryRecord;
            if (record?.archived && Number.isSafeInteger(record.archivedAt) && record.archivedAt! >= 0 && record.archivedAt! < 8640000000000000)
              stamp = Math.max(stamp, (record.archivedAt ?? 0) + 1);
            cursor.continue();
          } else {
            scanned = true;
            archive();
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            new Error(
              "Local recovery could not be archived. Its active journal has been retained.",
            ),
          );
        transaction.onerror = () =>
          reject(
            new Error(
              "Local recovery could not be archived. Its active journal has been retained.",
            ),
          );
      });
    },
    async archivedContent() {
      const db = await database();
      const prefix = scope.slice(0, scope.lastIndexOf(":") + 1);
      const record = await new Promise<RecoveryRecord | null>(
        (resolve, reject) => {
          let latest: RecoveryRecord | null = null;
          let latestTime = -1, latestId = "";
          const transaction = db.transaction("notes", "readonly");
          const request = transaction
            .objectStore("notes")
            .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const value = cursor.value as RecoveryRecord;
            const id = String(cursor.key);
            const stamp = Number.isSafeInteger(value?.archivedAt) && value.archivedAt! >= 0 && value.archivedAt! <= 8640000000000000 ? value.archivedAt! : 0;
            if (
              value?.archived === true &&
              (!latest || stamp > latestTime || (stamp === latestTime && id > latestId))
            ) {
              latest = value;
              latestTime = stamp; latestId = id;
            }
            cursor.continue();
          };
          transaction.oncomplete = () => resolve(latest);
          transaction.onabort = () =>
            reject(new Error("Archived recovery could not be read."));
          transaction.onerror = () =>
            reject(new Error("Archived recovery could not be read."));
        },
      );
      if (!record) return null;
      const doc = decodeDocument(record.state);
      try {
        return readContent(doc);
      } finally {
        doc.destroy();
      }
    },
  };
}
import * as Y from "yjs";
import {
  decodeDocument,
  encodeDocument,
  fromBase64,
  REMOTE_ORIGIN,
  validateDocument,
  readContent,
} from "./collaboration-model";
