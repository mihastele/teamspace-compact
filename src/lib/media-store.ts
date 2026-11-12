// Client-side IndexedDB media storage for local/preview images, videos, and files (MIT License)
// Allows storing large binary blobs (videos, images, attachments) without hitting localStorage's ~5MB quota.

import { useEffect, useState } from "react";

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

export function isIdbMediaUrl(url: string | null | undefined): url is string {
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

export async function resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!isIdbMediaUrl(url)) return url;

  const id = extractMediaId(url);
  const cached = objectUrlCache.get(id);
  if (cached) return cached;

  if (typeof indexedDB === "undefined") return null;

  try {
    const db = await openMediaDb();
    const record = await new Promise<StoredMediaRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as StoredMediaRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record?.blob) return null;
    const objUrl = URL.createObjectURL(record.blob);
    objectUrlCache.set(id, objUrl);
    return objUrl;
  } catch {
    return null;
  }
}

export function useMediaUrl(url: string | null | undefined): string | null {
  const [asyncResolved, setAsyncResolved] = useState<{
    source: string;
    resolved: string | null;
  } | null>(null);

  const needsAsyncLookup =
    isIdbMediaUrl(url) && !objectUrlCache.has(extractMediaId(url));

  useEffect(() => {
    if (!needsAsyncLookup || !url) return;
    let active = true;
    void resolveMediaUrl(url).then((nextUrl) => {
      if (active) setAsyncResolved({ source: url, resolved: nextUrl });
    });
    return () => {
      active = false;
    };
  }, [url, needsAsyncLookup]);

  if (!url) return null;
  if (!isIdbMediaUrl(url)) return url;
  const cached = objectUrlCache.get(extractMediaId(url));
  if (cached) return cached;
  if (asyncResolved && asyncResolved.source === url) return asyncResolved.resolved;
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
