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
};
export interface RecoveryStore {
  load(): Promise<RecoveryRecord | null>;
  save(record: RecoveryRecord): Promise<void>;
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
    async load() {
      const db = await database();
      let own = await new Promise<RecoveryRecord | null>((resolve, reject) => {
        const transaction = db.transaction("notes", "readonly");
        const request = transaction.objectStore("notes").get(scope);
        transaction.oncomplete = () => resolve(request.result ?? null);
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
        if (record.key === scope || !record.value.pending?.length) continue;
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
  };
}
import * as Y from "yjs";
import {
  decodeDocument,
  encodeDocument,
  fromBase64,
  REMOTE_ORIGIN,
  validateDocument,
} from "./collaboration-model";
