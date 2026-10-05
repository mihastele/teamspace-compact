import { randomUUID } from "node:crypto";
import { ApiError } from "./validation";
import { Timestamp, FieldValue as FirebaseFieldValue, type Firestore as FirebaseFirestore, type DocumentData } from "firebase-admin/firestore";
export { Timestamp };
export type StoreData = DocumentData;
export type StoreTransform = {
    readonly __teamspaceTransform: "timestamp" | "increment" | "delete";
    amount?: number;
};
export const FieldValue = {
    serverTimestamp: (): StoreTransform => ({ __teamspaceTransform: "timestamp" }),
    increment: (amount: number): StoreTransform => ({ __teamspaceTransform: "increment", amount }),
    delete: (): StoreTransform => ({ __teamspaceTransform: "delete" }),
};
export interface DocumentSnapshot {
    id: string;
    exists: boolean;
    ref: DocumentReference;
    data(): StoreData | undefined;
}
export interface QueryDocumentSnapshot extends DocumentSnapshot {
    data(): StoreData;
}
export interface QuerySnapshot {
    docs: QueryDocumentSnapshot[];
    size: number;
    empty: boolean;
}
export interface Query {
    where(field: string, operator: "==" | "<", value: unknown): Query;
    orderBy(field: string, direction?: "asc" | "desc"): Query;
    limit(count: number): Query;
    select(...fields: string[]): Query;
    get(): Promise<QuerySnapshot>;
}
export interface CollectionReference extends Query {
    path: string;
    id: string;
    doc(id?: string): DocumentReference;
}
export interface DocumentReference {
    id: string;
    path: string;
    collection(path: string): CollectionReference;
    get(): Promise<DocumentSnapshot>;
    delete(): Promise<unknown>;
}
export interface Transaction {
    get(ref: DocumentReference): Promise<DocumentSnapshot>;
    get(query: Query): Promise<QuerySnapshot>;
    set(ref: DocumentReference, data: StoreData, options?: {
        merge: boolean;
    }): void;
    create(ref: DocumentReference, data: StoreData): void;
    update(ref: DocumentReference, data: StoreData): void;
    delete(ref: DocumentReference): void;
}
export interface DocumentStore {
    doc(path: string): DocumentReference;
    collection(path: string): CollectionReference;
    runTransaction<T>(action: (tx: Transaction) => Promise<T>): Promise<T>;
    recursiveDelete(collection: CollectionReference): Promise<unknown>;
}
function firebaseValues(value: unknown): unknown {
    if (!value || typeof value !== "object" || value instanceof Timestamp)
        return value;
    const transform = value as StoreTransform;
    if (transform.__teamspaceTransform === "timestamp")
        return FirebaseFieldValue.serverTimestamp();
    if (transform.__teamspaceTransform === "increment")
        return FirebaseFieldValue.increment(transform.amount!);
    if (transform.__teamspaceTransform === "delete")
        return FirebaseFieldValue.delete();
    if (Array.isArray(value))
        return value.map(firebaseValues);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firebaseValues(child)]));
}
/** Native references/snapshots remain intact; only our explicit transforms adapt. */
export function firebaseDocumentStore(db: FirebaseFirestore): DocumentStore {
    return {
        doc: path => db.doc(path) as unknown as DocumentReference,
        collection: path => db.collection(path) as unknown as CollectionReference,
        recursiveDelete: ref => db.recursiveDelete(db.collection(ref.path)),
        runTransaction: action => db.runTransaction(async (native) => {
            const tx: Transaction = {
                get: ((ref: DocumentReference | Query) => native.get(ref as never)) as unknown as Transaction["get"],
                set: (ref, data, options) => { if (options)
                    native.set(db.doc(ref.path), firebaseValues(data) as StoreData, options);
                else
                    native.set(db.doc(ref.path), firebaseValues(data) as StoreData); },
                create: (ref, data) => { native.create(db.doc(ref.path), firebaseValues(data) as StoreData); },
                update: (ref, data) => { native.update(db.doc(ref.path), firebaseValues(data) as StoreData); },
                delete: ref => { native.delete(db.doc(ref.path)); },
            };
            return action(tx);
        }),
    };
}
export function encodeStoreValue(value: unknown): unknown {
    if (value instanceof Timestamp)
        return { $ts: value.toMillis() };
    if (!value || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(encodeStoreValue);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeStoreValue(child)]));
}
export function decodeStoreValue(value: unknown): unknown {
    if (!value || typeof value !== "object")
        return value;
    if ("$ts" in value && typeof value.$ts === "number")
        return Timestamp.fromMillis(value.$ts);
    if (Array.isArray(value))
        return value.map(decodeStoreValue);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeStoreValue(child)]));
}
export type RpcCall = (name: string, input: Record<string, unknown>) => Promise<{
    epoch: number | string;
    rows: Row[];
    conflict?: boolean;
}>;
export class StoreConflict extends Error {
}
type QuerySpec = {
    path: string;
    filters: {
        field: string;
        operator: "==" | "<";
        value: unknown;
    }[];
    order?: {
        field: string;
        direction: "asc" | "desc";
    };
    limit: number | null;
    fields?: string[];
};
type Row = {
    path: string;
    data: StoreData;
};
/** Optimistic callbacks commit through a single PostgreSQL atomic compare-and-swap. */
export function supabaseDocumentStore(rpc: RpcCall): DocumentStore {
    const snapshot = (row: Row | undefined, ref: DocumentReference): DocumentSnapshot => ({ id: ref.id, ref, exists: !!row, data: () => row ? decodeStoreValue(row.data) as StoreData : undefined });
    async function read(target: Ref | Collection, epoch: number | string | null): Promise<DocumentSnapshot | QuerySnapshot> {
        const result = await rpc("teamspace_store_read", { p_epoch: epoch, p_path: target.path, p_query: target instanceof Collection ? target.spec : null });
        if (result.conflict)
            throw new StoreConflict();
        const rows: Row[] = result.rows;
        if (target instanceof Ref)
            return snapshot(rows[0], target);
        const docs = rows.map(row => snapshot(row, new Ref(row.path))) as QueryDocumentSnapshot[];
        return { docs, size: docs.length, empty: docs.length === 0 };
    }
    class Ref implements DocumentReference {
        id: string;
        constructor(readonly path: string) { this.id = path.split("/").at(-1)!; }
        collection(path: string) { return new Collection(`${this.path}/${path}`); }
        get(): Promise<DocumentSnapshot> { return read(this, null) as Promise<DocumentSnapshot>; }
        delete() { return store.runTransaction(async (tx) => { tx.delete(this); }); }
    }
    class Collection implements CollectionReference {
        id: string;
        spec: QuerySpec;
        constructor(readonly path: string, spec?: QuerySpec) { this.id = path.split("/").at(-1)!; this.spec = spec ?? { path, filters: [], limit: null }; }
        doc(id = randomUUID()) { return new Ref(`${this.path}/${id}`); }
        where(field: string, operator: "==" | "<", value: unknown) { return new Collection(this.path, { ...this.spec, filters: [...this.spec.filters, { field, operator, value: encodeStoreValue(value) }] }); }
        orderBy(field: string, direction: "asc" | "desc" = "asc") { return new Collection(this.path, { ...this.spec, order: { field, direction } }); }
        limit(count: number) { return new Collection(this.path, { ...this.spec, limit: count }); }
        select(...fields: string[]) { return new Collection(this.path, { ...this.spec, fields }); }
        get() { return read(this, null) as Promise<QuerySnapshot>; }
    }
    const store: DocumentStore = {
        doc: path => new Ref(path), collection: path => new Collection(path),
        async runTransaction(action) {
            for (let attempt = 0; attempt < 12; attempt++) {
                const { epoch } = await rpc("teamspace_store_epoch", {});
                if (!/^[0-9]+$/.test(String(epoch)) || (typeof epoch === "number" && !Number.isSafeInteger(epoch)))
                    throw new Error("Invalid document transaction epoch.");
                const writes: {
                    kind: string;
                    path: string;
                    data?: unknown;
                    merge?: boolean;
                }[] = [];
                const tx: Transaction = {
                    get: ((target: Ref | Collection) => { if (writes.length)
                        throw new Error("Transaction reads must precede writes."); return read(target, epoch); }) as Transaction["get"],
                    set: (ref, data, options) => { writes.push({ kind: "set", path: ref.path, data: encodeStoreValue(data), merge: !!options?.merge }); },
                    create: (ref, data) => { writes.push({ kind: "create", path: ref.path, data: encodeStoreValue(data) }); },
                    update: (ref, data) => { writes.push({ kind: "update", path: ref.path, data: encodeStoreValue(data) }); },
                    delete: ref => { writes.push({ kind: "delete", path: ref.path }); },
                };
                try {
                    const value = await action(tx);
                    const result = await rpc("teamspace_store_commit", { p_epoch: epoch, p_writes: writes });
                    if (!result.conflict)
                        return value;
                }
                catch (error) {
                    if (!(error instanceof StoreConflict))
                        throw error;
                }
                await new Promise(resolve => setTimeout(resolve, Math.min(100, 5 * (attempt + 1)) + Math.floor(Math.random() * 10)));
            }
            throw new ApiError(503, "transaction_contention", "The workspace is busy. Retry shortly; your local work has been kept.");
        },
        recursiveDelete: collection => rpc("teamspace_store_delete_collection", { p_path: collection.path }),
    };
    return store;
}
