"use client";

// Allowed MIME types up to 25 MB
export const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Audio
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  // Documents & Archives
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MiB

/** Strips EXIF metadata from JPEG / PNG / WebP by rendering onto canvas. */
export async function prepareImageBlob(file: File, keepOriginal = false): Promise<Blob> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("File exceeds the 25 MB size limit.");
  }

  // GIF or non-image bypass canvas
  if (file.type === "image/gif" || !file.type.startsWith("image/")) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const maxDim = keepOriginal ? Math.max(bitmap.width, bitmap.height) : 2048;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const mime = file.type === "image/png" ? "image/png" : "image/webp";
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), mime, 0.85)
      );
      return blob || file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

// Local IndexedDB cache for offline/preview media attachments
let mediaDbPromise: Promise<IDBDatabase> | null = null;
function getMediaDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (!mediaDbPromise) {
    mediaDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("teamspace-media-cache-v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("media");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return mediaDbPromise;
}

export async function storeLocalMedia(id: string, blob: Blob): Promise<string> {
  try {
    const db = await getMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // In-memory fallback
  }
  return URL.createObjectURL(blob);
}

export async function getLocalMedia(id: string): Promise<string | null> {
  try {
    const db = await getMediaDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction("media", "readonly");
      const req = tx.objectStore("media").get(id);
      req.onsuccess = () => resolve(req.result as Blob);
      req.onerror = () => reject(req.error);
    });
    if (blob) {
      return URL.createObjectURL(blob);
    }
  } catch {
    // ignore
  }
  return null;
}

export type UploadResult = {
  attachmentId: string;
  url: string;
  originalName: string;
  contentType: string;
  bytes: number;
};

/** Unified uploader for images, audio and general files. */
export async function uploadMediaFile(
  file: File,
  parentType: "page" | "task" | "note",
  parentId: string,
  api: {
    configured: boolean;
    user?: { uid: string } | null;
    workspace?: { id: string } | null;
  },
  options: { keepOriginal?: boolean } = {}
): Promise<UploadResult> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`File type "${file.type || "unknown"}" is not supported.`);
  }

  const preparedBlob = file.type.startsWith("image/")
    ? await prepareImageBlob(file, options.keepOriginal)
    : file;

  if (preparedBlob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("File exceeds the 25 MB size limit.");
  }

  // 1. If running against configured backend with signed-in user
  if (api.configured && api.user && api.workspace) {
    const path = `workspaces/${api.workspace.id}`;
    // Register upload
    const initRes = await fetch(`/api/${path}/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parentType: parentType === "page" ? "note" : parentType,
        parentId,
        originalName: file.name,
        contentType: preparedBlob.type || file.type,
        bytes: preparedBlob.size,
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || "Could not reserve attachment upload.");
    }

    const { attachmentId, uploadUrl, uploadHeaders } = await initRes.json();

    // PUT to signed storage URL
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: uploadHeaders || { "Content-Type": preparedBlob.type || file.type },
      body: preparedBlob,
    });

    if (!uploadRes.ok) {
      await fetch(`/api/${path}/attachments/${attachmentId}`, { method: "DELETE" }).catch(() => {});
      throw new Error("Upload transfer failed. Please try again.");
    }

    // Complete upload
    const completeRes = await fetch(`/api/${path}/attachments/${attachmentId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (!completeRes.ok) {
      throw new Error("Could not verify completed attachment.");
    }

    // Authenticated inline streaming URL
    const inlineUrl = `/api/${path}/attachments/${attachmentId}/inline`;

    return {
      attachmentId,
      url: inlineUrl,
      originalName: file.name,
      contentType: preparedBlob.type || file.type,
      bytes: preparedBlob.size,
    };
  }

  // 2. Offline / Local preview mode: Cache in IndexedDB
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const objectUrl = await storeLocalMedia(localId, preparedBlob);

  return {
    attachmentId: localId,
    url: objectUrl,
    originalName: file.name,
    contentType: preparedBlob.type || file.type,
    bytes: preparedBlob.size,
  };
}
