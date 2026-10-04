import type { StoragePort } from "./storage-port";

const MAX_BYTES = 10 * 1024 * 1024;
type Configuration = { url: string; key: string; bucket: string; fetch?: typeof fetch; now?: () => number };
class StorageFailure extends Error {
  constructor(public code: number, message: string) { super(message); }
}
function configuration(input?: Configuration) {
  const config = input ?? { url: process.env.SUPABASE_URL ?? "", key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", bucket: process.env.SUPABASE_STORAGE_BUCKET ?? "" };
  if (!config.url || !config.key || !/^[a-zA-Z0-9_-]+$/.test(config.bucket)) throw new StorageFailure(503, "Private storage is not configured.");
  return { ...config, url: config.url.replace(/\/$/, ""), fetch: config.fetch ?? fetch, now: config.now ?? Date.now };
}
function validPath(path: string) {
  if (!path || path.length > 1024 || path.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f\\]/.test(path)) throw new StorageFailure(400, "Invalid storage path.");
  return path.split("/").map(encodeURIComponent).join("/");
}
async function boundedBody(response: Request | Response, maximum: number, exact?: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) throw new StorageFailure(413, "File exceeds the allowed size.");
  const reader = response.body?.getReader();
  if (!reader) throw new StorageFailure(400, "File body is missing.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new StorageFailure(413, "File exceeds the allowed size."); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  if (exact !== undefined && size !== exact) throw new StorageFailure(400, "File size does not match its reservation.");
  return Buffer.concat(chunks, size);
}

/** Narrow create-only private-object port. Browser storage policies must deny writes. */
export function supabaseStorage(input?: Configuration): StoragePort {
  const config = configuration(input);
  async function rawRequest(path: string, init?: RequestInit) {
    const response = await config.fetch(`${config.url}/storage/v1/${path}`, { ...init, cache: "no-store", headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, ...init?.headers } });
    if (!response.ok) {
      let status = response.status;
      try { const data = await response.json(); status = Number(data.statusCode) || status; if (/already exists|duplicate/i.test(data.message ?? data.error ?? "")) status = 412; } catch { /* Keep HTTP status; never expose upstream credentials or content. */ }
      throw new StorageFailure(status, status === 404 ? "File not found." : status === 412 ? "File already exists." : "Private storage request failed.");
    }
    return response;
  }
  let verifiedBucket: Promise<void> | undefined;
  async function request(path: string, init?: RequestInit) {
    verifiedBucket ??= rawRequest(`bucket/${encodeURIComponent(config.bucket)}`).then(async response => {
      const bucket = await response.json();
      if (bucket.public !== false || Number(bucket.file_size_limit) !== MAX_BYTES)
        throw new StorageFailure(503, "The attachment bucket must be private with the configured 10 MiB limit. Apply the storage migration.");
    });
    await verifiedBucket;
    return rawRequest(path, init);
  }
  return {
    bucket(name = config.bucket) {
      if (name !== config.bucket) throw new StorageFailure(400, "Invalid private bucket.");
      return {
        file(path, options) {
          const encoded = `${encodeURIComponent(name)}/${validPath(path)}`;
          async function metadata() {
            const info = await (await request(`object/info/${encoded}`)).json();
            const size = Number(info.size ?? info.metadata?.size);
            const contentType = info.content_type ?? info.contentType ?? info.metadata?.mimetype;
            if (!info.id || !Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES || typeof contentType !== "string") throw new StorageFailure(409, "Invalid private object metadata.");
            const generation = `${info.id}:${info.version ?? ""}`;
            if (options?.generation !== undefined && String(options.generation) !== generation) throw new StorageFailure(412, "The private object changed.");
            return { size, contentType, generation };
          }
          return {
            async getMetadata() { return [await metadata()]; },
            async download() {
              const before = await metadata();
              const bytes = await boundedBody(await request(`object/${encoded}`), MAX_BYTES, before.size);
              const after = await metadata();
              if (before.generation !== after.generation) throw new StorageFailure(412, "The private object changed during download.");
              return [bytes];
            },
            async delete({ ignoreNotFound }) {
              try {
                if (options?.generation !== undefined) await metadata();
                return await request(`object/${encodeURIComponent(name)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
              } catch (error) { if (ignoreNotFound && error instanceof StorageFailure && error.code === 404) return; throw error; }
            },
            async save(bytes, settings) {
              if (settings.preconditionOpts.ifGenerationMatch !== 0 || bytes.byteLength > MAX_BYTES) throw new StorageFailure(400, "Only bounded create-only writes are supported.");
              return await request(`object/${encoded}`, { method: "POST", headers: { "Content-Type": settings.contentType, "x-upsert": "false", "cache-control": "max-age=0" }, body: new Uint8Array(bytes) });
            },
            async getSignedUrl(settings) {
              if (settings.action === "write") {
                const range = settings.extensionHeaders?.["x-goog-content-length-range"];
                const [minimum, maximum] = (range ?? "").split(",").map(Number);
                if (minimum !== maximum || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_BYTES || settings.extensionHeaders?.["x-goog-if-generation-match"] !== "0" || !settings.contentType) throw new StorageFailure(400, "An exact create-only upload reservation is required.");
                // Supabase signs create-only uploads for two hours. Bucket policy enforces
                // the absolute size/MIME cap; completion validates the exact reservation.
                const result = await (await request(`object/upload/sign/${encoded}`, { method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "false" }, body: "{}" })).json();
                if (typeof result.url !== "string" || !result.url.startsWith("/object/upload/sign/")) throw new StorageFailure(503, "Upload signing failed.");
                return [new URL(`${config.url}/storage/v1${result.url}`).toString()];
              }
              const expiresIn = Math.min(60, Math.floor((settings.expires - config.now()) / 1000));
              if (expiresIn < 1) throw new StorageFailure(400, "Download expiry is invalid.");
              const result = await (await request(`object/sign/${encoded}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn }) })).json();
              if (typeof result.signedURL !== "string" || !result.signedURL.startsWith("/object/sign/")) throw new StorageFailure(503, "Download signing failed.");
              const url = new URL(`${config.url}/storage/v1${result.signedURL}`);
              if (settings.responseDisposition?.startsWith("attachment")) {
                const filename = settings.responseDisposition.match(/filename\*=UTF-8''(.*)/)?.[1];
                url.searchParams.set("download", filename ? decodeURIComponent(filename) : "");
              }
              return [url.toString()];
            },
          };
        },
      };
    },
  };
}
