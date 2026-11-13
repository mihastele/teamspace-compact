// Client-side IndexedDB media storage for local/preview images, videos, and files (MIT License)
// Allows storing large binary blobs (videos, images, attachments) without hitting localStorage's ~5MB quota.

import { useEffect, useState } from "react";
import { browserAccessToken } from "./browser-backend";
import { getLocalMedia, deleteLocalMedia, storeLocalMedia } from "./attachments";

const DB_NAME = "teamspace_media_v1";
const STORE_NAME = "media";
const IDB_PREFIX = "idb://";

export type StoredMediaMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
};

type StoredMediaRecord = StoredMediaMeta & {
  blob: Blob;
};

const objectUrlCache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openMediaDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open media database."));
  });
  return dbPromise;
}

export function isIdbMediaUrl(url: string | null | undefined): url is `idb://${string}` {
  return typeof url === "string" && url.startsWith(IDB_PREFIX);
}

export function extractMediaId(url: string): string {
  return url.slice(IDB_PREFIX.length);
}

export async function saveMediaFile(file: File | Blob, fileName?: string): Promise<{
  url: string;
  meta: StoredMediaMeta;
}> {
  const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = fileName || (file instanceof File ? file.name : "attachment");
  const mimeType = file.type || "application/octet-stream";
  const size = file.size;
  const createdAt = Date.now();

  const record: StoredMediaRecord = {
    id,
    name,
    mimeType,
    size,
    createdAt,
    blob: file,
  };

  if (typeof indexedDB !== "undefined") {
    const db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to store media."));
    });
  }

  const url = `${IDB_PREFIX}${id}`;
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    objectUrlCache.set(id, URL.createObjectURL(file));
  }

  return {
    url,
    meta: { id, name, mimeType, size, createdAt },
  };
}

export async function deleteMediaFile(urlOrId: string | null | undefined): Promise<void> {
  if (typeof urlOrId !== "string" || !urlOrId.trim()) return;
  const id = isIdbMediaUrl(urlOrId) ? extractMediaId(urlOrId) : urlOrId;
  objectUrlCache.delete(id);
  objectUrlCache.delete(urlOrId);

  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openMediaDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
    void deleteLocalMedia(id);
  }
}

export async function resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
  if (typeof url !== "string" || !url.trim()) return null;
  const cleanUrl = url.trim();

  const cached = objectUrlCache.get(cleanUrl);
  if (cached) return cached;

  if (isIdbMediaUrl(cleanUrl)) {
    const id = extractMediaId(cleanUrl);
    const cachedById = objectUrlCache.get(id);
    if (cachedById) return cachedById;

    if (typeof indexedDB === "undefined") return null;

    try {
      const db = await openMediaDb();
      const record = await new Promise<StoredMediaRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result as StoredMediaRecord | undefined);
        req.onerror = () => reject(req.error);
      });
      if (record?.blob) {
        const objUrl = URL.createObjectURL(record.blob);
        objectUrlCache.set(id, objUrl);
        objectUrlCache.set(url, objUrl);
        return objUrl;
      }
    } catch {}

    const localFallback = await getLocalMedia(id);
    if (localFallback) {
      objectUrlCache.set(id, localFallback);
      objectUrlCache.set(url, localFallback);
      return localFallback;
    }
    return null;
  }

  if (cleanUrl.startsWith("local-")) {
    const local = await getLocalMedia(cleanUrl);
    if (local) {
      objectUrlCache.set(cleanUrl, local);
      return local;
    }
  }

  // Server attachment endpoint (e.g. /api/workspaces/.../attachments/.../inline)
  if (cleanUrl.startsWith("/api/") && cleanUrl.includes("/attachments/")) {
    try {
      const token = await browserAccessToken();
      const res = await fetch(cleanUrl, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.url && typeof data.url === "string") {
          objectUrlCache.set(cleanUrl, data.url);

          // If this is an image attachment, cache the blob for offline usage
          const match = /\/attachments\/([^/]+)/.exec(cleanUrl);
          const attachmentId = match?.[1];
          if (attachmentId && (cleanUrl.includes("image") || data.url.includes(".png") || data.url.includes(".jpg") || data.url.includes(".webp"))) {
            void fetch(data.url)
              .then((r) => r.blob())
              .then((blob) => {
                void storeLocalMedia(attachmentId, blob);
              })
              .catch(() => {});
          }

          return data.url;
        }
      }
    } catch {
      // Offline fallback: check if local cache has this image
      const match = /\/attachments\/([^/]+)/.exec(cleanUrl);
      const attachmentId = match?.[1];
      if (attachmentId) {
        const local = await getLocalMedia(attachmentId);
        if (local) {
          objectUrlCache.set(cleanUrl, local);
          return local;
        }
      }
    }
  }

  return cleanUrl;
}

export function useMediaUrl(url: string | null | undefined): string | null {
  const [asyncResolved, setAsyncResolved] = useState<{
    source: string;
    resolved: string | null;
  } | null>(null);

  const safeUrl = typeof url === "string" && url.trim().length > 0 ? url.trim() : null;

  const needsAsyncLookup =
    Boolean(safeUrl) &&
    (isIdbMediaUrl(safeUrl) ||
      safeUrl!.startsWith("local-") ||
      (safeUrl!.startsWith("/api/") && safeUrl!.includes("/attachments/"))) &&
    !objectUrlCache.has(safeUrl!) &&
    !(isIdbMediaUrl(safeUrl) && objectUrlCache.has(extractMediaId(safeUrl)));

  useEffect(() => {
    if (!needsAsyncLookup || !safeUrl) return;
    let active = true;
    void resolveMediaUrl(safeUrl).then((nextUrl) => {
      if (active) setAsyncResolved({ source: safeUrl, resolved: nextUrl });
    });
    return () => {
      active = false;
    };
  }, [safeUrl, needsAsyncLookup]);

  if (!safeUrl) return null;
  const cached = objectUrlCache.get(safeUrl) || (isIdbMediaUrl(safeUrl) ? objectUrlCache.get(extractMediaId(safeUrl)) : null);
  if (cached) return cached;
  if (asyncResolved && asyncResolved.source === safeUrl) return asyncResolved.resolved;
  if (!isIdbMediaUrl(safeUrl) && !safeUrl.startsWith("local-") && !safeUrl.startsWith("/api/")) return safeUrl;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
