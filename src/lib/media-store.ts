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
const signedUrlExpiry = new Map<string, number>();
let dbPromise: Promise<IDBDatabase> | null = null;

export function primeMediaUrlCache(key: string, objectUrl: string): void {
  if (!key || !objectUrl) return;
  objectUrlCache.set(key, objectUrl);
  signedUrlExpiry.delete(key);
}

export function invalidateMediaUrlCache(key: string | null | undefined): void {
  if (!key) return;
  const trimmed = key.trim();
  objectUrlCache.delete(trimmed);
  signedUrlExpiry.delete(trimmed);
}

function getValidCachedUrl(key: string): string | null {
  const val = objectUrlCache.get(key);
  if (!val) return null;
  const exp = signedUrlExpiry.get(key);
  if (typeof exp === "number" && Date.now() >= exp) {
    objectUrlCache.delete(key);
    signedUrlExpiry.delete(key);
    return null;
  }
  return val;
}

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

  const cached = getValidCachedUrl(cleanUrl);
  if (cached) return cached;

  if (isIdbMediaUrl(cleanUrl)) {
    const id = extractMediaId(cleanUrl);
    const cachedById = getValidCachedUrl(id);
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
    return null;
  }

  // Server attachment endpoint (e.g. /api/workspaces/.../attachments/.../inline)
  if (cleanUrl.startsWith("/api/") && cleanUrl.includes("/attachments/")) {
    const match = /\/attachments\/([^/?]+)/.exec(cleanUrl);
    const attachmentId = match?.[1];

    // Check if this attachment is an image already cached in local IndexedDB
    if (attachmentId) {
      const localCached = await getLocalMedia(attachmentId);
      if (localCached) {
        objectUrlCache.set(cleanUrl, localCached);
        signedUrlExpiry.delete(cleanUrl);
        return localCached;
      }
    }

    try {
      const token = await browserAccessToken().catch(() => null);
      const urlWithToken = token && !cleanUrl.includes("token=")
        ? `${cleanUrl}${cleanUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
        : cleanUrl;
      const res = await fetch(urlWithToken, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.url && typeof data.url === "string") {
          objectUrlCache.set(cleanUrl, data.url);
          signedUrlExpiry.set(cleanUrl, Date.now() + 45 * 60 * 1000);

          // If this is an image attachment, cache the blob in IndexedDB for instant/offline usage
          if (
            attachmentId &&
            (cleanUrl.includes("image") ||
              /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(data.url))
          ) {
            void fetch(data.url)
              .then((r) => (r.ok ? r.blob() : null))
              .then((blob) => {
                if (blob && blob.type.startsWith("image/")) {
                  void storeLocalMedia(attachmentId, blob);
                }
              })
              .catch(() => {});
          }

          return data.url;
        }
      }
    } catch {
      // Offline fallback: check if local cache has this image
      if (attachmentId) {
        const local = await getLocalMedia(attachmentId);
        if (local) {
          objectUrlCache.set(cleanUrl, local);
          signedUrlExpiry.delete(cleanUrl);
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
  const cachedImmediate = safeUrl
    ? getValidCachedUrl(safeUrl) ||
      (isIdbMediaUrl(safeUrl) ? getValidCachedUrl(extractMediaId(safeUrl)) : null)
    : null;

  const needsAsyncLookup =
    Boolean(safeUrl) &&
    (isIdbMediaUrl(safeUrl) ||
      safeUrl!.startsWith("local-") ||
      (safeUrl!.startsWith("/api/") && safeUrl!.includes("/attachments/"))) &&
    !cachedImmediate;

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
  if (cachedImmediate) return cachedImmediate;
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
