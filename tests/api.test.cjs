const { before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const Module = require("node:module");
const sharp = require("sharp");
// Next replaces this boundary module at build time. Only the test loader stubs it.
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === "server-only" ? {} : originalLoad.call(this, id, ...args); };
const { handleTrustedApi } = require("../.test-build/api.js");
Module._load = originalLoad;

let app, db, storage;
before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run this suite through the isolated Firebase emulator.");
  app = initializeApp({ projectId: "demo-teamspace" }, "trusted-api-tests");
  db = getFirestore(app);
  storage = getStorage(app);
});
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-teamspace/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.status, 200);
  await Promise.all([
    db.doc("workspaces/alpha").set({ name: "Alpha", ownerId: "owner" }),
    db.doc("workspaces/alpha/members/owner").set({ role: "owner", displayName: "Owner" }),
    db.doc("workspaces/alpha/members/member").set({ role: "member", displayName: "Member" }),
    db.doc("users/owner/workspaces/alpha").set({}),
    db.doc("users/member/workspaces/alpha").set({}),
    db.doc("workspaces/alpha/tasks/task").set({ title: "Original", description: "", status: "todo", assigneeId: "member", dueDate: null, position: 0 }),
    db.doc("workspaces/alpha/notes/note").set({ title: "Original", content: { blocks: [] }, revision: 1 }),
  ]);
});
after(async () => { if (app) await deleteApp(app); });

async function api(uid, method, path, input, storageOverride = storage) {
  const request = new Request(`http://localhost/api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input) });
  const response = await handleTrustedApi(request, path.split("/"), { db, storage: storageOverride, user: { uid, name: uid } });
  return { status: response.status, data: await response.json() };
}
const prefix = "workspaces/alpha";

test("nonmembers cannot mutate content or manage workspace membership", async () => {
  for (const [method, path, body] of [
    ["POST", `${prefix}/tasks`, { title: "Attack" }],
    ["PATCH", `${prefix}/tasks/task`, { title: "Attack" }],
    ["DELETE", `${prefix}/tasks/task`],
    ["POST", `${prefix}/notes`, { title: "Attack", content: { blocks: [] } }],
    ["DELETE", `${prefix}/notes/note`],
    ["DELETE", `${prefix}/members/member`],
    ["POST", `${prefix}/invites`, {}],
    ["PATCH", `${prefix}/owner`, { uid: "outsider" }],
  ]) assert.equal((await api("outsider", method, path, body)).status, 403, path);
  assert.equal((await db.doc(`${prefix}/tasks/task`).get()).data().title, "Original");
});

test("task changes validate assignment and reject immutable-field mass assignment", async () => {
  assert.equal((await api("member", "PATCH", `${prefix}/tasks/task`, { assigneeId: "outsider" })).status, 400);
  assert.equal((await api("member", "PATCH", `${prefix}/tasks/task`, { createdBy: "attacker" })).status, 400);
  assert.equal((await api("member", "PATCH", `${prefix}/tasks/task`, { status: "done" })).status, 200);
  assert.equal((await db.doc(`${prefix}/tasks/task`).get()).data().status, "done");
});

test("simultaneous note saves choose one winner and retain the winner's revision", async () => {
  const drafts = ["First draft", "Second draft"];
  const results = await Promise.all(drafts.map(title => api("member", "PATCH", `${prefix}/notes/note`, { title, content: { blocks: [{ type: "paragraph", text: title }] }, expectedRevision: 1 })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200).data.note;
  const loser = results.find(result => result.status === 409);
  assert.equal(loser.data.error.code, "revision_conflict");
  const saved = (await db.doc(`${prefix}/notes/note`).get()).data();
  assert.equal(saved.revision, 2);
  assert.equal(saved.title, winner.title);
  assert.equal(saved.content.blocks[0].text, winner.title);
});

test("owner cannot leave; transfer moves authority and former owner can leave", async () => {
  assert.equal((await api("owner", "DELETE", `${prefix}/members/owner`)).status, 409);
  assert.equal((await api("member", "PATCH", `${prefix}/owner`, { uid: "member" })).status, 403);
  assert.equal((await api("owner", "PATCH", `${prefix}/owner`, { uid: "outsider" })).status, 400);
  assert.equal((await api("owner", "PATCH", `${prefix}/owner`, { uid: "member" })).status, 200);
  assert.equal((await db.doc(prefix).get()).data().ownerId, "member");
  assert.equal((await db.doc(`${prefix}/members/member`).get()).data().role, "owner");
  assert.equal((await db.doc(`${prefix}/members/owner`).get()).data().role, "member");
  assert.equal((await api("owner", "POST", `${prefix}/invites`, {})).status, 403);
  assert.equal((await api("owner", "DELETE", `${prefix}/members/owner`)).status, 200);
  assert.equal((await db.doc("users/owner/workspaces/alpha").get()).exists, false);
});

test("removal clears task assignments and blocks the removed member's subsequent writes", async () => {
  assert.equal((await api("member", "DELETE", `${prefix}/members/owner`)).status, 403);
  assert.equal((await api("owner", "DELETE", `${prefix}/members/member`)).status, 200);
  assert.equal((await db.doc(`${prefix}/tasks/task`).get()).data().assigneeId, null);
  assert.equal((await db.doc("users/member/workspaces/alpha").get()).exists, false);
  assert.equal((await api("member", "PATCH", `${prefix}/tasks/task`, { title: "Late write" })).status, 403);
});

test("invitation redemption is atomic, idempotent for members, and use limits cannot be raced", async () => {
  const created = await api("owner", "POST", `${prefix}/invites`, { maxUses: 1 });
  assert.equal(created.status, 201);
  assert.equal(created.data.token.length, 43);
  const stored = (await db.doc(`invites/${created.data.hash}`).get()).data();
  assert.equal("token" in stored, false);
  const results = await Promise.all(["new-a", "new-b"].map(uid => api(uid, "POST", "invites/redeem", { token: created.data.token })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 410]);
  assert.equal((await db.doc(`invites/${created.data.hash}`).get()).data().uses, 1);
  const members = await db.collection(`${prefix}/members`).get();
  assert.equal(members.size, 3);
});

test("existing membership does not consume invitation use, revoked and expired invites fail", async () => {
  const created = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal((await api("member", "POST", "invites/redeem", { token: created.data.token })).status, 200);
  assert.equal((await db.doc(`invites/${created.data.hash}`).get()).data().uses, 0);
  assert.equal((await api("member", "DELETE", `${prefix}/invites/${created.data.hash}`)).status, 403);
  assert.equal((await api("owner", "DELETE", `${prefix}/invites/${created.data.hash}`)).status, 200);
  assert.equal((await api("new-user", "POST", "invites/redeem", { token: created.data.token })).status, 410);
  const expired = await api("owner", "POST", `${prefix}/invites`, {});
  await db.doc(`invites/${expired.data.hash}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await api("new-user", "POST", "invites/redeem", { token: expired.data.token })).status, 410);
});

test("revoke-all prevents every outstanding invitation from being redeemed", async () => {
  const first = await api("owner", "POST", `${prefix}/invites`, {});
  const second = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal((await api("owner", "DELETE", `${prefix}/invites`)).status, 200);
  for (const invite of [first, second]) assert.equal((await api("new-user", "POST", "invites/redeem", { token: invite.data.token })).status, 410);
});

test("distributed invitation rate limits reject the eleventh create in a minute", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await api("owner", "POST", `${prefix}/invites`, {})).status, 201);
  const limited = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, "rate_limited");
});

function fakeStorage() {
  const objects = new Map();
  const signatures = [];
  const backend = { bucket: () => ({ file: path => ({
    getSignedUrl: async options => { signatures.push({ path, options }); return ["https://example.invalid/private-signed-url"]; },
    getMetadata: async () => { const file = objects.get(path); if (!file) throw new Error("File missing"); return [{ size: file.bytes.length, contentType: file.contentType, generation: 1 }]; },
    download: async () => [objects.get(path).bytes],
    save: async (bytes, options) => { if (objects.has(path)) throw Object.assign(new Error("Generation mismatch"), { code: 412 }); objects.set(path, { bytes, contentType: options.contentType }); },
    delete: async () => { objects.delete(path); },
  }) }) };
  return { backend, objects, signatures };
}

test("signed upload policy binds exact length and create-only generation before accepting bytes", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const files = fakeStorage();
  const created = await api("member", "POST", `${prefix}/attachments`, { parentType: "task", parentId: "task", originalName: "photo.png", contentType: "image/png", bytes: 120 }, files.backend);
  assert.equal(created.status, 201);
  assert.equal(created.data.uploadHeaders["x-goog-content-length-range"], "120,120");
  assert.equal(files.signatures[0].options.extensionHeaders["x-goog-content-length-range"], "120,120");
  assert.equal(files.signatures[0].options.extensionHeaders["x-goog-if-generation-match"], "0");
  assert.equal((await api("outsider", "POST", `${prefix}/attachments`, { parentType: "task", parentId: "task", originalName: "photo.png", contentType: "image/png", bytes: 120 }, files.backend)).status, 403);
  assert.equal((await api("member", "POST", `${prefix}/attachments`, { parentType: "task", parentId: "task", originalName: "photo.png", contentType: "image/png", bytes: 11 * 1024 * 1024 }, files.backend)).status, 400);
});

test("completion decodes image, generates a private 400px transparent thumbnail, and deletion cleans both", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const bytes = await sharp({ create: { width: 800, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();
  const files = fakeStorage();
  const created = await api("member", "POST", `${prefix}/attachments`, { parentType: "task", parentId: "task", originalName: "transparent.png", contentType: "image/png", bytes: bytes.length }, files.backend);
  const attachmentId = created.data.attachmentId;
  const ref = db.doc(`${prefix}/attachments/${attachmentId}`);
  const pending = (await ref.get()).data();
  files.objects.set(pending.stagingPath, { bytes, contentType: "image/png" });
  const completed = await api("member", "POST", `${prefix}/attachments/${attachmentId}/complete`, {}, files.backend);
  assert.equal(completed.status, 200);
  assert.equal(completed.data.attachment.hasThumbnail, true);
  const saved = (await ref.get()).data();
  assert.equal(saved.status, "ready");
  assert.deepEqual(files.objects.get(saved.storagePath).bytes, bytes);
  const thumb = await sharp(files.objects.get(saved.thumbnailPath).bytes).metadata();
  assert.equal(thumb.width, 400);
  assert.equal(thumb.height, 100);
  assert.equal(thumb.hasAlpha, true);
  assert.equal(files.objects.has(saved.stagingPath), false);
  assert.equal((await api("outsider", "GET", `${prefix}/attachments/${attachmentId}/thumbnail`, undefined, files.backend)).status, 403);
  assert.equal((await api("member", "GET", `${prefix}/attachments/${attachmentId}/thumbnail`, undefined, files.backend)).status, 200);
  assert.equal((await api("member", "DELETE", `${prefix}/attachments/${attachmentId}`, undefined, files.backend)).status, 200);
  assert.equal(files.objects.size, 0);
  assert.equal((await ref.get()).exists, false);
});

test("header-only corrupt images are rejected and never promoted to ready metadata", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const files = fakeStorage();
  const created = await api("member", "POST", `${prefix}/attachments`, { parentType: "task", parentId: "task", originalName: "broken.png", contentType: "image/png", bytes: bytes.length }, files.backend);
  const ref = db.doc(`${prefix}/attachments/${created.data.attachmentId}`);
  const value = (await ref.get()).data();
  files.objects.set(value.stagingPath, { bytes, contentType: "image/png" });
  const completed = await api("member", "POST", `${prefix}/attachments/${created.data.attachmentId}/complete`, {}, files.backend);
  assert.equal(completed.status, 400);
  assert.equal(completed.data.error.code, "invalid_file");
  assert.equal((await ref.get()).data().status, "pending");
  assert.equal(files.objects.size, 0);
});
