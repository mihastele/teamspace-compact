export type BrowserRow = Record<string, unknown> & {
    id: string;
};
export type SnapshotRunner = {
    invalidate(coalesce?: boolean): void;
    stop(): void;
};
export class SnapshotReadError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}
export function terminalSnapshotReadFailure(error: unknown): boolean {
    return error instanceof SnapshotReadError && [401, 403, 404].includes(error.status);
}
/** Serialize reads and suppress any response invalidated while it was in flight. */
export function createSnapshotRunner<T>({ read, publish, fail, isCurrent }: {
    read: () => Promise<T>;
    publish: (value: T) => void;
    fail: (error: Error) => void;
    isCurrent: () => boolean;
}): SnapshotRunner {
    let active = true;
    let running = false;
    let dirty = false;
    async function pump() {
        running = true;
        try {
            do {
                dirty = false;
                const value = await read();
                if (!active || !isCurrent())
                    return;
                if (!dirty)
                    publish(value);
            } while (active && dirty && isCurrent());
        }
        catch (error) {
            dirty = false;
            if (active && isCurrent())
                fail(error instanceof Error ? error : new Error("Workspace synchronization failed."));
        }
        finally {
            running = false;
        }
    }
    return {
        invalidate(coalesce = false) { if (!active || (coalesce && running))
            return; dirty = true; if (!running)
            void pump(); },
        stop() { active = false; },
    };
}
/** Reject malformed responses rather than silently treating missing data as deletion. */
export function collectionSnapshotRows(route: string, value: unknown): Record<string, BrowserRow[]> {
    if (!value || typeof value !== "object")
        throw new Error("Invalid workspace snapshot.");
    const data = value as Record<string, unknown>;
    const rows = (name: string) => {
        const list = data[name];
        if (!Array.isArray(list) || list.some((row) => !row || typeof row !== "object" || typeof row.id !== "string"))
            throw new Error("Invalid workspace snapshot.");
        return list as BrowserRow[];
    };
    if (route.endsWith("/snapshot")) {
        const base = route.slice(0, -"snapshot".length);
        return Object.fromEntries(["tasks", "notes", "members", "attachments", "boardProperties"].map((name) => [`${base}${name}`, name === "boardProperties" && data[name] === undefined ? [] : rows(name)]));
    }
    const name = route.split("/").at(-1);
    if (name !== "comments" && name !== "presence")
        throw new Error("Unsupported workspace snapshot.");
    return { [route]: rows(name) };
}
