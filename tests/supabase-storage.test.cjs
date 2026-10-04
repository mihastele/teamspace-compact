const { test } = require("node:test");
const assert = require("node:assert/strict");
const { supabaseStorage } = require("../.test-build/server/supabase-storage.js");
function harness() {
  const objects = new Map(), calls = [];
  let serial = 0;
  const config = { url: "http://storage.test", key: "test-service-key-never-a-real-secret", bucket: "private", now: () => 1000,
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname.replace("/storage/v1/", "");
      calls.push({ path, ...init });
      if (path === 'bucket/private') return Response.json({ public: false, file_size_limit: 10 * 1024 * 1024 });
      if (path.startsWith("object/upload/sign/")) return Response.json({ url: `/${path}?token=upload` });
      if (path.startsWith("object/sign/")) return Response.json({ signedURL: `/${path}?token=read` });
      const info = path.startsWith("object/info/");
      const key = path.replace(info ? "object/info/private/" : "object/private/", "");
      if (init.method === "DELETE") { for (const name of JSON.parse(init.body).prefixes) objects.delete(name); return Response.json([]); }
      if (init.method === "POST") {
        assert.equal(init.headers["x-upsert"], "false");
        if (objects.has(key)) return Response.json({ message: "The resource already exists", statusCode: "409" }, { status: 409 });
        objects.set(key, { bytes: Buffer.from(init.body), id: String(++serial), type: init.headers["Content-Type"] });
        return Response.json({});
      }
      const object = objects.get(key);
      if (!object) return Response.json({ statusCode: "404" }, { status: 404 });
      return info ? Response.json({ id: object.id, version: "1", size: object.bytes.length, content_type: object.type }) : new Response(object.bytes);
    },
  };
  return { config, storage: supabaseStorage(config), objects, calls };
}
const settings = { resumable: false, contentType: "application/pdf", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: "private, no-store" } };
function signing(bytes = 3) { return { version: "v4", action: "write", expires: 10000, contentType: "application/pdf", extensionHeaders: { "x-goog-content-length-range": `${bytes},${bytes}`, "x-goog-if-generation-match": "0" } }; }
test("Supabase writes and signed uploads are create-only", async () => {
  const h = harness(), file = h.storage.bucket().file("staging/ws/file");
  const [url] = await file.getSignedUrl(signing());
  assert.ok(url.startsWith("http://storage.test/storage/v1/object/upload/sign/private/staging/ws/file?"));
  assert.equal(h.calls.find(call => call.path.startsWith('object/upload/sign/')).headers["x-upsert"], "false");
  await file.save(Buffer.from("pdf"), settings);
  await assert.rejects(file.save(Buffer.from("bad"), settings), error => error.code === 412);
  assert.equal(h.objects.values().next().value.bytes.toString(), "pdf");
  await assert.rejects(file.save(Buffer.alloc(11 * 1024 * 1024), settings), /bounded/);
});
test("Supabase signing validates reservations and bounds download expiry", async () => {
  const h = harness(), file = h.storage.bucket().file("staging/ws/file");
  await assert.rejects(file.getSignedUrl(signing(11 * 1024 * 1024)), /reservation/);
  await assert.rejects(file.getSignedUrl({ ...signing(), extensionHeaders: {} }), /reservation/);
  assert.throws(() => h.storage.bucket("public"), /bucket/);
  assert.throws(() => h.storage.bucket().file("../secret"), /path/);
  const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: 1000000, responseDisposition: "attachment; filename*=UTF-8''my%20file.pdf" });
  assert.equal(JSON.parse(h.calls.find(call => call.path.startsWith('object/sign/')).body).expiresIn, 60);
  assert.equal(new URL(url).searchParams.get("download"), "my file.pdf");
  assert.ok(!url.includes(h.config.key));
});
test("Supabase pinned downloads reject recreated objects", async () => {
  const h = harness(), file = h.storage.bucket().file("staging/ws/file");
  await file.save(Buffer.from("pdf"), settings);
  const [metadata] = await file.getMetadata();
  const pinned = () => h.storage.bucket().file("staging/ws/file", { generation: metadata.generation });
  assert.equal((await pinned().download())[0].toString(), "pdf");
  await file.delete({ ignoreNotFound: true });
  await file.save(Buffer.from("bad"), settings);
  await assert.rejects(pinned().download(), /changed/);
});
test("Supabase detects mid-read recreation and cancels oversized downloads", async () => {
  const h = harness(), file = h.storage.bucket().file("staging/ws/file");
  await file.save(Buffer.from("pdf"), settings);
  const base = h.config.fetch;
  h.config.fetch = async (url, init) => { const response = await base(url, init); if (url.endsWith("object/private/staging/ws/file")) h.objects.get("staging/ws/file").id = "changed"; return response; };
  await assert.rejects(supabaseStorage(h.config).bucket().file("staging/ws/file").download(), /changed/);
  let cancelled = false;
  h.config.fetch = async (url, init) => url.endsWith("object/private/staging/ws/file") ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)); }, cancel() { cancelled = true; } })) : base(url, init);
  await assert.rejects(supabaseStorage(h.config).bucket().file("staging/ws/file").download(), /exceeds/);
  assert.equal(cancelled, true);
});
test('Supabase refuses public or unbounded buckets before issuing capabilities', async () => {
  for(const metadata of [{public:true,file_size_limit:10485760},{public:false,file_size_limit:null}]) {
    const storage=supabaseStorage({url:'http://storage.test',key:'test-only',bucket:'private',fetch:async()=>Response.json(metadata)});
    await assert.rejects(storage.bucket().file('staging/w/id').getSignedUrl(signing()),/must be private/);
  }
});
