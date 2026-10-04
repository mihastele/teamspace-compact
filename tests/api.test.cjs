const { before, after, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const Module = require("node:module");
const sharp = require("sharp");
// Next replaces this boundary module at build time. Only the test loader stubs it.
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  return id === "server-only" ? {} : originalLoad.call(this, id, ...args);
};
const { handleTrustedApi } = require("../.test-build/server/api.js");
Module._load = originalLoad;

let app, db, storage;
before(() => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "Run this suite through the isolated Firebase emulator.",
  );
  app = initializeApp({ projectId: "demo-teamspace" }, "trusted-api-tests");
  db = getFirestore(app);
  storage = getStorage(app);
});
beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-teamspace/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 200);
  await Promise.all([
    db.doc("workspaces/alpha").set({ name: "Alpha", ownerId: "owner" }),
    db
      .doc("workspaces/alpha/members/owner")
      .set({ role: "owner", displayName: "Owner" }),
    db
      .doc("workspaces/alpha/members/member")
      .set({ role: "member", displayName: "Member" }),
    db.doc("users/owner/workspaces/alpha").set({}),
    db.doc("users/member/workspaces/alpha").set({}),
    db.doc("workspaces/alpha/tasks/task").set({
      title: "Original",
      description: "",
      status: "todo",
      assigneeId: "member",
      dueDate: null,
      position: 0,
    }),
    db
      .doc("workspaces/alpha/notes/note")
      .set({ title: "Original", content: { blocks: [] }, revision: 1 }),
  ]);
});
after(async () => {
  if (app) await deleteApp(app);
});

async function api(uid, method, path, input, storageOverride = storage) {
  const request = new Request(`http://localhost/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const response = await handleTrustedApi(request, path.split("/"), {
    db,
    storage: storageOverride,
    user: { uid, name: uid },
  });
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
  ])
    assert.equal((await api("outsider", method, path, body)).status, 403, path);
  assert.equal(
    (await db.doc(`${prefix}/tasks/task`).get()).data().title,
    "Original",
  );
});

test("task changes validate assignment and reject immutable-field mass assignment", async () => {
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/tasks/task`, {
        assigneeId: "outsider",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/tasks/task`, {
        createdBy: "attacker",
      })
    ).status,
    400,
  );
  assert.equal(
    (await api("member", "PATCH", `${prefix}/tasks/task`, { status: "done" }))
      .status,
    200,
  );
  assert.equal(
    (await db.doc(`${prefix}/tasks/task`).get()).data().status,
    "done",
  );
});

test("simultaneous note saves choose one winner and retain the winner's revision", async () => {
  const drafts = ["First draft", "Second draft"];
  const results = await Promise.all(
    drafts.map((title) =>
      api("member", "PATCH", `${prefix}/notes/note`, {
        title,
        content: { blocks: [{ type: "paragraph", text: title }] },
        expectedRevision: 1,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200).data.note;
  const loser = results.find((result) => result.status === 409);
  assert.equal(loser.data.error.code, "revision_conflict");
  const saved = (await db.doc(`${prefix}/notes/note`).get()).data();
  assert.equal(saved.revision, 2);
  assert.equal(saved.title, winner.title);
  assert.equal(saved.content.blocks[0].text, winner.title);
});

test("owner cannot leave; transfer moves authority and former owner can leave", async () => {
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/members/owner`)).status,
    409,
  );
  assert.equal(
    (await api("member", "PATCH", `${prefix}/owner`, { uid: "member" })).status,
    403,
  );
  assert.equal(
    (await api("owner", "PATCH", `${prefix}/owner`, { uid: "outsider" }))
      .status,
    400,
  );
  assert.equal(
    (await api("owner", "PATCH", `${prefix}/owner`, { uid: "member" })).status,
    200,
  );
  assert.equal((await db.doc(prefix).get()).data().ownerId, "member");
  assert.equal(
    (await db.doc(`${prefix}/members/member`).get()).data().role,
    "owner",
  );
  assert.equal(
    (await db.doc(`${prefix}/members/owner`).get()).data().role,
    "member",
  );
  assert.equal(
    (await api("owner", "POST", `${prefix}/invites`, {})).status,
    403,
  );
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/members/owner`)).status,
    200,
  );
  assert.equal(
    (await db.doc("users/owner/workspaces/alpha").get()).exists,
    false,
  );
});

test("removal clears task assignments and blocks the removed member's subsequent writes", async () => {
  assert.equal(
    (await api("member", "DELETE", `${prefix}/members/owner`)).status,
    403,
  );
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/members/member`)).status,
    200,
  );
  assert.equal(
    (await db.doc(`${prefix}/tasks/task`).get()).data().assigneeId,
    null,
  );
  assert.equal(
    (await db.doc("users/member/workspaces/alpha").get()).exists,
    false,
  );
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/tasks/task`, {
        title: "Late write",
      })
    ).status,
    403,
  );
});

test("invitation redemption is atomic, idempotent for members, and use limits cannot be raced", async () => {
  const created = await api("owner", "POST", `${prefix}/invites`, {
    maxUses: 1,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.token.length, 43);
  const stored = (await db.doc(`invites/${created.data.hash}`).get()).data();
  assert.equal("token" in stored, false);
  const results = await Promise.all(
    ["new-a", "new-b"].map((uid) =>
      api(uid, "POST", "invites/redeem", { token: created.data.token }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 410]);
  assert.equal(
    (await db.doc(`invites/${created.data.hash}`).get()).data().uses,
    1,
  );
  const members = await db.collection(`${prefix}/members`).get();
  assert.equal(members.size, 3);
});

test("existing membership does not consume invitation use, revoked and expired invites fail", async () => {
  const created = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal(
    (
      await api("member", "POST", "invites/redeem", {
        token: created.data.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.doc(`invites/${created.data.hash}`).get()).data().uses,
    0,
  );
  assert.equal(
    (await api("member", "DELETE", `${prefix}/invites/${created.data.hash}`))
      .status,
    403,
  );
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/invites/${created.data.hash}`))
      .status,
    200,
  );
  assert.equal(
    (
      await api("new-user", "POST", "invites/redeem", {
        token: created.data.token,
      })
    ).status,
    410,
  );
  const expired = await api("owner", "POST", `${prefix}/invites`, {});
  await db
    .doc(`invites/${expired.data.hash}`)
    .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal(
    (
      await api("new-user", "POST", "invites/redeem", {
        token: expired.data.token,
      })
    ).status,
    410,
  );
});

test("revoke-all prevents every outstanding invitation from being redeemed", async () => {
  const first = await api("owner", "POST", `${prefix}/invites`, {});
  const second = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal((await api("owner", "DELETE", `${prefix}/invites`)).status, 200);
  for (const invite of [first, second])
    assert.equal(
      (
        await api("new-user", "POST", "invites/redeem", {
          token: invite.data.token,
        })
      ).status,
      410,
    );
});

test("distributed invitation rate limits reject the eleventh create and reset next minute", async (context) => {
  let clock = Date.now();
  context.mock.method(Date, "now", () => clock);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await api("owner", "POST", `${prefix}/invites`, {})).status,
      201,
    );
  const limited = await api("owner", "POST", `${prefix}/invites`, {});
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, "rate_limited");
  clock += 60000;
  assert.equal(
    (await api("owner", "POST", `${prefix}/invites`, {})).status,
    201,
  );
});

function fakeStorage() {
  const objects = new Map();
  const signatures = [];
  const backend = {
    bucket: () => ({
      file: (path) => ({
        getSignedUrl: async (options) => {
          signatures.push({ path, options });
          return ["https://example.invalid/private-signed-url"];
        },
        getMetadata: async () => {
          const file = objects.get(path);
          if (!file) throw new Error("File missing");
          return [
            {
              size: file.bytes.length,
              contentType: file.contentType,
              generation: 1,
            },
          ];
        },
        download: async () => [objects.get(path).bytes],
        save: async (bytes, options) => {
          if (objects.has(path))
            throw Object.assign(new Error("Generation mismatch"), {
              code: 412,
            });
          objects.set(path, { bytes, contentType: options.contentType });
        },
        delete: async () => {
          objects.delete(path);
        },
      }),
    }),
  };
  return { backend, objects, signatures };
}

test("signed upload policy binds exact length and create-only generation before accepting bytes", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const files = fakeStorage();
  const created = await api(
    "member",
    "POST",
    `${prefix}/attachments`,
    {
      parentType: "task",
      parentId: "task",
      originalName: "photo.png",
      contentType: "image/png",
      bytes: 120,
    },
    files.backend,
  );
  assert.equal(created.status, 201);
  assert.equal(
    created.data.uploadHeaders["x-goog-content-length-range"],
    "120,120",
  );
  assert.equal(
    files.signatures[0].options.extensionHeaders["x-goog-content-length-range"],
    "120,120",
  );
  assert.equal(
    files.signatures[0].options.extensionHeaders["x-goog-if-generation-match"],
    "0",
  );
  assert.equal(
    (
      await api(
        "outsider",
        "POST",
        `${prefix}/attachments`,
        {
          parentType: "task",
          parentId: "task",
          originalName: "photo.png",
          contentType: "image/png",
          bytes: 120,
        },
        files.backend,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        "member",
        "POST",
        `${prefix}/attachments`,
        {
          parentType: "task",
          parentId: "task",
          originalName: "photo.png",
          contentType: "image/png",
          bytes: 11 * 1024 * 1024,
        },
        files.backend,
      )
    ).status,
    400,
  );
});

test("completion decodes image, generates a private 400px transparent thumbnail, and deletion cleans both", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const bytes = await sharp({
    create: {
      width: 800,
      height: 200,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const files = fakeStorage();
  const created = await api(
    "member",
    "POST",
    `${prefix}/attachments`,
    {
      parentType: "task",
      parentId: "task",
      originalName: "transparent.png",
      contentType: "image/png",
      bytes: bytes.length,
    },
    files.backend,
  );
  const attachmentId = created.data.attachmentId;
  const ref = db.doc(`${prefix}/attachments/${attachmentId}`);
  const pending = (await ref.get()).data();
  files.objects.set(pending.stagingPath, { bytes, contentType: "image/png" });
  const completed = await api(
    "member",
    "POST",
    `${prefix}/attachments/${attachmentId}/complete`,
    {},
    files.backend,
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.data.attachment.hasThumbnail, true);
  const saved = (await ref.get()).data();
  assert.equal(saved.status, "ready");
  assert.deepEqual(files.objects.get(saved.storagePath).bytes, bytes);
  const thumb = await sharp(
    files.objects.get(saved.thumbnailPath).bytes,
  ).metadata();
  assert.equal(thumb.width, 400);
  assert.equal(thumb.height, 100);
  assert.equal(thumb.hasAlpha, true);
  assert.equal(files.objects.has(saved.stagingPath), false);
  assert.equal(
    (
      await api(
        "outsider",
        "GET",
        `${prefix}/attachments/${attachmentId}/thumbnail`,
        undefined,
        files.backend,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        "member",
        "GET",
        `${prefix}/attachments/${attachmentId}/thumbnail`,
        undefined,
        files.backend,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        "member",
        "DELETE",
        `${prefix}/attachments/${attachmentId}`,
        undefined,
        files.backend,
      )
    ).status,
    200,
  );
  assert.equal(files.objects.size, 0);
  assert.equal((await ref.get()).exists, false);
});

test("header-only corrupt images are rejected and never promoted to ready metadata", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const files = fakeStorage();
  const created = await api(
    "member",
    "POST",
    `${prefix}/attachments`,
    {
      parentType: "task",
      parentId: "task",
      originalName: "broken.png",
      contentType: "image/png",
      bytes: bytes.length,
    },
    files.backend,
  );
  const ref = db.doc(`${prefix}/attachments/${created.data.attachmentId}`);
  const value = (await ref.get()).data();
  files.objects.set(value.stagingPath, { bytes, contentType: "image/png" });
  const completed = await api(
    "member",
    "POST",
    `${prefix}/attachments/${created.data.attachmentId}/complete`,
    {},
    files.backend,
  );
  assert.equal(completed.status, 400);
  assert.equal(completed.data.error.code, "invalid_file");
  assert.equal((await ref.get()).data().status, "pending");
  assert.equal(files.objects.size, 0);
});

async function createNote(title, parentId = null, uid = "member") {
  const result = await api(uid, "POST", `${prefix}/notes`, {
    title,
    content: { blocks: [] },
    parentId,
  });
  assert.equal(result.status, 201);
  return result.data.note;
}
function moveInput(note, parentId, title = note.title) {
  return {
    title,
    content: note.content,
    expectedRevision: note.revision,
    parentId,
  };
}

test("legacy roots normalize on save; nested notes share workspace access and omitted parents stay unchanged", async () => {
  const legacy = await api("member", "PATCH", `${prefix}/notes/note`, {
    title: "Legacy root",
    content: { blocks: [] },
    expectedRevision: 1,
  });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.note.parentId, null);
  const root = await createNote("Root");
  const child = await createNote("Child", root.id);
  const deeper = await createNote("Deeper", child.id, "owner");
  assert.equal(root.parentId, null);
  assert.equal(child.parentId, root.id);
  assert.equal(deeper.parentId, child.id);
  const edited = await api("member", "PATCH", `${prefix}/notes/${deeper.id}`, {
    title: "Shared member edit",
    content: { blocks: [{ type: "paragraph", text: "Shared" }] },
    expectedRevision: 1,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.note.parentId, child.id);
  assert.equal(edited.data.note.revision, 2);
  assert.equal((await db.doc(prefix).get()).data().noteTreeRevision, 3);
  const rooted = await api(
    "member",
    "PATCH",
    `${prefix}/notes/${deeper.id}`,
    moveInput(edited.data.note, null),
  );
  assert.equal(rooted.status, 200);
  assert.equal(rooted.data.note.parentId, null);
  assert.equal(rooted.data.note.revision, 3);
  assert.equal((await db.doc(prefix).get()).data().noteTreeRevision, 4);
});

test("parents must be live notes in the same workspace and outsiders cannot create or move nested notes", async () => {
  await db.doc("workspaces/beta").set({ name: "Other", ownerId: "member" });
  await db
    .doc("workspaces/beta/notes/private-parent")
    .set({ title: "Private", revision: 1 });
  await db
    .doc(`${prefix}/notes/deleting-parent`)
    .set({ title: "Deleting", revision: 1, deleting: true });
  for (const parentId of ["missing", "private-parent", "deleting-parent"]) {
    const result = await api("member", "POST", `${prefix}/notes`, {
      title: "Child",
      content: { blocks: [] },
      parentId,
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, "invalid_parent");
  }
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes`, {
        title: "Child",
        content: { blocks: [] },
        parentId: "../beta",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("outsider", "POST", `${prefix}/notes`, {
        title: "Child",
        content: { blocks: [] },
        parentId: "note",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("outsider", "PATCH", `${prefix}/notes/note`, {
        title: "Attack",
        content: { blocks: [] },
        expectedRevision: 1,
        parentId: null,
      })
    ).status,
    403,
  );
  assert.equal((await db.doc(`${prefix}/notes/note`).get()).data().revision, 1);
});

test("self, descendant and existing corrupt cycles are rejected without changing revisions", async () => {
  const root = await createNote("Root");
  const child = await createNote("Child", root.id);
  const deeper = await createNote("Deeper", child.id);
  for (const parentId of [root.id, child.id, deeper.id]) {
    const result = await api(
      "member",
      "PATCH",
      `${prefix}/notes/${root.id}`,
      moveInput(root, parentId),
    );
    assert.equal(result.status, 409);
    assert.equal(result.data.error.code, "note_cycle");
  }
  assert.equal(
    (await db.doc(`${prefix}/notes/${root.id}`).get()).data().revision,
    1,
  );
  assert.equal(
    (await db.doc(`${prefix}/notes/${root.id}`).get()).data().parentId,
    null,
  );
  await db
    .doc(`${prefix}/notes/corrupt-a`)
    .set({ title: "Corrupt A", revision: 1, parentId: "corrupt-b" });
  await db
    .doc(`${prefix}/notes/corrupt-b`)
    .set({ title: "Corrupt B", revision: 1, parentId: "corrupt-a" });
  const corrupt = await api("member", "POST", `${prefix}/notes`, {
    title: "Child",
    content: { blocks: [] },
    parentId: "corrupt-a",
  });
  assert.equal(corrupt.status, 409);
  assert.equal(corrupt.data.error.code, "note_cycle");
});

test("parent deletion refuses children before modifying flags, metadata or private attachment bytes", async () => {
  process.env.FIREBASE_STORAGE_BUCKET = "test-private-bucket";
  const root = await createNote("Root");
  const child = await createNote("Child", root.id);
  const deeper = await createNote("Deeper", child.id);
  const files = fakeStorage();
  const attachmentPath = "private/root-file";
  files.objects.set(attachmentPath, {
    bytes: Buffer.from("retained"),
    contentType: "application/pdf",
  });
  const attachmentRef = db.doc(`${prefix}/attachments/root-file`);
  await attachmentRef.set({
    parentType: "note",
    parentId: root.id,
    status: "ready",
    storagePath: attachmentPath,
    stagingPath: "staging/root-file",
  });
  const deleted = await api(
    "owner",
    "DELETE",
    `${prefix}/notes/${root.id}`,
    undefined,
    files.backend,
  );
  assert.equal(deleted.status, 409);
  assert.equal(deleted.data.error.code, "note_has_children");
  assert.equal(
    (await db.doc(`${prefix}/notes/${root.id}`).get()).data().deleting,
    undefined,
  );
  assert.equal((await attachmentRef.get()).data().status, "ready");
  assert.equal(files.objects.get(attachmentPath).bytes.toString(), "retained");
  for (const note of [child, deeper])
    assert.equal(
      (await db.doc(`${prefix}/notes/${note.id}`).get()).exists,
      true,
    );
  assert.equal(
    (await api("member", "DELETE", `${prefix}/notes/${deeper.id}`)).status,
    200,
  );
  assert.equal(
    (await api("member", "DELETE", `${prefix}/notes/${child.id}`)).status,
    200,
  );
  assert.equal(
    (
      await api(
        "member",
        "DELETE",
        `${prefix}/notes/${root.id}`,
        undefined,
        files.backend,
      )
    ).status,
    200,
  );
  assert.equal(files.objects.size, 0);
  assert.equal((await attachmentRef.get()).exists, false);
});

test("concurrent reciprocal moves serialize and cannot create a cycle", async () => {
  const first = await createNote("First");
  const second = await createNote("Second");
  const results = await Promise.all([
    api(
      "member",
      "PATCH",
      `${prefix}/notes/${first.id}`,
      moveInput(first, second.id),
    ),
    api(
      "owner",
      "PATCH",
      `${prefix}/notes/${second.id}`,
      moveInput(second, first.id),
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    results.find((result) => result.status === 409).data.error.code,
    "note_cycle",
  );
  const savedFirst = (await db.doc(`${prefix}/notes/${first.id}`).get()).data();
  const savedSecond = (
    await db.doc(`${prefix}/notes/${second.id}`).get()
  ).data();
  assert.equal(
    savedFirst.parentId === null || savedSecond.parentId === null,
    true,
  );
  assert.equal(savedFirst.revision + savedSecond.revision, 3);
});

test("concurrent child create versus parent delete either retains the full tree or rejects the child", async () => {
  const parent = await createNote("Parent");
  const [created, deleted] = await Promise.all([
    api("member", "POST", `${prefix}/notes`, {
      title: "Child",
      content: { blocks: [] },
      parentId: parent.id,
    }),
    api("owner", "DELETE", `${prefix}/notes/${parent.id}`),
  ]);
  const parentExists = (await db.doc(`${prefix}/notes/${parent.id}`).get())
    .exists;
  const children = await db
    .collection(`${prefix}/notes`)
    .where("parentId", "==", parent.id)
    .get();
  if (created.status === 201) {
    assert.equal(deleted.status, 409);
    assert.equal(parentExists, true);
    assert.equal(children.size, 1);
  } else {
    assert.equal(created.status, 400);
    assert.equal(deleted.status, 200);
    assert.equal(parentExists, false);
    assert.equal(children.empty, true);
  }
});

test("concurrent child move versus parent delete cannot leave the moved note orphaned", async () => {
  const parent = await createNote("Parent");
  const child = await createNote("Independent");
  const [moved, deleted] = await Promise.all([
    api(
      "member",
      "PATCH",
      `${prefix}/notes/${child.id}`,
      moveInput(child, parent.id),
    ),
    api("owner", "DELETE", `${prefix}/notes/${parent.id}`),
  ]);
  const saved = (await db.doc(`${prefix}/notes/${child.id}`).get()).data();
  const parentExists = (await db.doc(`${prefix}/notes/${parent.id}`).get())
    .exists;
  if (moved.status === 200) {
    assert.equal(deleted.status, 409);
    assert.equal(saved.parentId, parent.id);
    assert.equal(parentExists, true);
  } else {
    assert.equal(moved.status, 400);
    assert.equal(deleted.status, 200);
    assert.equal(saved.parentId, null);
    assert.equal(saved.revision, 1);
    assert.equal(parentExists, false);
  }
});

test("concurrent moves of the same note preserve one winner and reject the stale draft", async () => {
  const child = await createNote("Child");
  const first = await createNote("First destination");
  const second = await createNote("Second destination");
  const results = await Promise.all([
    api(
      "member",
      "PATCH",
      `${prefix}/notes/${child.id}`,
      moveInput(child, first.id, "First draft"),
    ),
    api(
      "owner",
      "PATCH",
      `${prefix}/notes/${child.id}`,
      moveInput(child, second.id, "Second draft"),
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    results.find((result) => result.status === 409).data.error.code,
    "revision_conflict",
  );
  const winner = results.find((result) => result.status === 200).data.note;
  const saved = (await db.doc(`${prefix}/notes/${child.id}`).get()).data();
  assert.equal(saved.parentId, winner.parentId);
  assert.equal(saved.title, winner.title);
  assert.equal(saved.revision, 2);
});

test("extended Markdown and board blocks persist through trusted saves without changing workspace tasks", async () => {
  const content = {
    blocks: [
      { type: "heading", text: "Second level", level: 2 },
      { type: "todo", text: "Done", checked: true },
      { type: "markdown", text: "| A | B |\n| - | - |\n| 1 | 2 |" },
      { type: "board", text: "" },
    ],
  };
  const saved = await api("member", "PATCH", `${prefix}/notes/note`, {
    title: "Rich note",
    content,
    expectedRevision: 1,
  });
  assert.equal(saved.status, 200);
  const stored = await db.doc(`${prefix}/notes/note`).get();
  assert.deepEqual(stored.data().content, content);
  const removedEmbed = await api("owner", "PATCH", `${prefix}/notes/note`, {
    title: "Rich note",
    content: { blocks: [{ type: "paragraph", text: "Board removed" }] },
    expectedRevision: 2,
  });
  assert.equal(removedEmbed.status, 200);
  assert.equal((await db.doc(`${prefix}/tasks/task`).get()).exists, true);
  const outsider = await api("stranger", "PATCH", `${prefix}/notes/note`, {
    title: "Bad",
    content,
    expectedRevision: 3,
  });
  assert.equal(outsider.status, 403);
});

const Y = require("yjs");
const { randomUUID } = require("node:crypto");
const {
  decodeDocument,
  readContent,
  applyEditorContent,
  toBase64,
} = require("../.test-build/collaboration-model.js");
async function promoted() {
  await db.doc(`${prefix}/notes/note`).update({
    content: {
      blocks: [
        { type: "paragraph", text: "Alpha" },
        { type: "paragraph", text: "Beta" },
        { type: "paragraph", text: "Gamma" },
      ],
    },
  });
  const [a, b] = await Promise.all([
    api("owner", "POST", `${prefix}/notes/note/collaboration`, {}),
    api("member", "POST", `${prefix}/notes/note/collaboration`, {}),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.note.collab.generation, b.data.note.collab.generation);
  assert.deepEqual(a.data.note.content, b.data.note.content);
  return a.data.note;
}
function editOperation(note, change, client) {
  const doc = client ?? decodeDocument(note.collab.state);
  const before = readContent(doc),
    next = structuredClone(before);
  const vector = Y.encodeStateVector(doc);
  change(next);
  applyEditorContent(doc, before, next);
  return {
    doc,
    input: {
      operationId: randomUUID(),
      generation: note.collab.generation,
      update: toBase64(Y.encodeStateAsUpdate(doc, vector)),
    },
  };
}
async function currentNote() {
  return (await db.doc(`${prefix}/notes/note`).get()).data();
}
async function sendOperation(uid, op) {
  return api(uid, "POST", `${prefix}/notes/note/updates`, op.input);
}

test("collaboration merges concurrent different-block and same-text edits with acknowledged final state", async () => {
  const note = await promoted();
  const a = editOperation(note, (c) => {
    c.blocks[0].text = "Alpha A";
  });
  const b = editOperation(note, (c) => {
    c.blocks[1].text = "Beta B";
  });
  const responses = await Promise.all([
    sendOperation("owner", a),
    sendOperation("member", b),
  ]);
  responses.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.data)));
  let state = await currentNote();
  assert.deepEqual(
    state.content.blocks.map((b) => b.text),
    ["Alpha A", "Beta B", "Gamma"],
  );
  assert.equal(state.collab.sequence, 2);
  const base = { ...state, id: "note" };
  const x = editOperation(base, (c) => {
    c.blocks[0].text += " X";
  });
  const y = editOperation(base, (c) => {
    c.blocks[0].text += " Y";
  });
  for (const r of await Promise.all([
    sendOperation("owner", x),
    sendOperation("member", y),
  ]))
    assert.equal(r.status, 200);
  state = await currentNote();
  assert.match(state.content.blocks[0].text, / X/);
  assert.match(state.content.blocks[0].text, / Y/);
  for (const doc of [a.doc, b.doc, x.doc, y.doc]) doc.destroy();
});

test("concurrent inserts and move/edit preserve globally unique deterministic blocks", async () => {
  const note = await promoted();
  const a = editOperation(note, (c) => {
    c.blocks.splice(1, 0, { type: "heading", text: "Inserted A", level: 2 });
  });
  const b = editOperation(note, (c) => {
    c.blocks.splice(1, 0, { type: "paragraph", text: "Inserted B" });
  });
  for (const r of await Promise.all([
    sendOperation("owner", a),
    sendOperation("member", b),
  ]))
    assert.equal(r.status, 200, JSON.stringify(r.data));
  let state = await currentNote();
  assert.equal(state.content.blocks.length, 5);
  assert.equal(new Set(state.content.blocks.map((b) => b.id)).size, 5);
  const merged = new Y.Doc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(a.doc));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(b.doc));
  assert.deepEqual(readContent(merged), state.content);
  const base = { ...state, id: "note" };
  const move = editOperation(base, (c) => {
    c.blocks.unshift(c.blocks.pop());
  });
  const edit = editOperation(base, (c) => {
    c.blocks[0].text = "Edited while moved";
  });
  for (const r of await Promise.all([
    sendOperation("owner", move),
    sendOperation("member", edit),
  ]))
    assert.equal(r.status, 200, JSON.stringify(r.data));
  state = await currentNote();
  assert.equal(state.content.blocks[0].text, "Gamma");
  assert.equal(
    state.content.blocks.find((b) => b.id === base.content.blocks[0].id).text,
    "Edited while moved",
  );
  for (const doc of [a.doc, b.doc, merged, move.doc, edit.doc]) doc.destroy();
});

test("deletion tombstones prevent resurrection by stale edits, duplicate requests do not mutate", async () => {
  const note = await promoted();
  const stale = editOperation(note, (c) => {
    c.blocks[0].text = "Stale edit";
  });
  const remove = editOperation(note, (c) => {
    c.blocks.shift();
  });
  assert.equal((await sendOperation("owner", remove)).status, 200);
  assert.equal((await sendOperation("member", stale)).status, 200);
  const before = await currentNote();
  assert.equal(before.content.blocks.length, 2);
  assert.ok(
    !before.content.blocks.some((b) => b.id === note.content.blocks[0].id),
  );
  assert.equal((await sendOperation("member", stale)).status, 200);
  assert.deepEqual((await currentNote()).collab, before.collab);
  const changed = editOperation({ ...before, id: "note" }, (c) => {
    c.blocks[0].text = "Changed payload";
  });
  changed.input.operationId = stale.input.operationId;
  assert.equal(
    (await sendOperation("member", changed)).data.error.code,
    "operation_conflict",
  );
  for (const doc of [stale.doc, remove.doc, changed.doc]) doc.destroy();
});

test("ordered offline updates reject missing dependencies then survive retry and response-loss replay", async () => {
  const note = await promoted();
  const first = editOperation(note, (c) => {
    c.blocks[0].text += " First";
  });
  const second = editOperation(
    note,
    (c) => {
      c.blocks[0].text += " Second";
    },
    first.doc,
  );
  const remote = editOperation(note, (c) => {
    c.blocks[1].text = "Remote while offline";
  });
  assert.equal((await sendOperation("owner", remote)).status, 200);
  const outOfOrder = await sendOperation("member", second);
  assert.equal(outOfOrder.status, 409);
  assert.equal(outOfOrder.data.error.code, "missing_dependencies");
  assert.equal((await sendOperation("member", first)).status, 200);
  assert.equal((await sendOperation("member", first)).status, 200);
  assert.equal((await sendOperation("member", second)).status, 200);
  const saved = await currentNote();
  assert.deepEqual(
    saved.content.blocks.map((b) => b.text),
    ["Alpha First Second", "Remote while offline", "Gamma"],
  );
  assert.equal(saved.collab.sequence, 3);
  assert.deepEqual(
    readContent(decodeDocument(saved.collab.state)),
    saved.content,
  );
  first.doc.destroy();
  remote.doc.destroy();
});

test("generation, malformed payload, legacy writes and revoked members are fenced", async () => {
  const note = await promoted();
  const op = editOperation(note, (c) => {
    c.blocks[0].text = "Update";
  });
  assert.equal(
    (await api("outsider", "POST", `${prefix}/notes/note/collaboration`, {}))
      .status,
    403,
  );
  assert.equal((await sendOperation("outsider", op)).status, 403);
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/notes/note`, {
        title: "Legacy",
        content: { blocks: [] },
        expectedRevision: note.revision,
      })
    ).data.error.code,
    "collaboration_required",
  );
  const generation = op.input.generation;
  op.input.generation = randomUUID();
  assert.equal(
    (await sendOperation("member", op)).data.error.code,
    "generation_conflict",
  );
  op.input.generation = generation;
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes/note/updates`, {
        ...op.input,
        update: "bogus",
      })
    ).status,
    400,
  );
  await db.doc(`${prefix}/members/member`).delete();
  assert.equal((await sendOperation("member", op)).status, 403);
  assert.equal((await currentNote()).collab.sequence, 0);
  op.doc.destroy();
});

test("metadata revision is independent of concurrent content and title updates preserve content", async () => {
  const note = await promoted();
  const op = editOperation(note, (c) => {
    c.blocks[0].text = "Concurrent content";
  });
  assert.equal((await sendOperation("member", op)).status, 200);
  const metadata = await api(
    "owner",
    "PATCH",
    `${prefix}/notes/note/metadata`,
    {
      title: "New title",
      parentId: null,
      expectedRevision: note.metadataRevision,
    },
  );
  assert.equal(metadata.status, 200, JSON.stringify(metadata.data));
  assert.equal(metadata.data.note.content.blocks[0].text, "Concurrent content");
  assert.equal(metadata.data.note.collab.sequence, 1);
  assert.equal(metadata.data.note.metadataRevision, note.metadataRevision + 1);
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/notes/note/metadata`, {
        title: "Stale title",
        expectedRevision: note.metadataRevision,
      })
    ).status,
    409,
  );
  op.doc.destroy();
});

test("presence identity is server-derived and deleting a note removes leases and receipts without replay resurrection", async () => {
  const note = await promoted(),
    sessionId = randomUUID();
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes/note/presence`, {
        sessionId,
      })
    ).status,
    200,
  );
  const leases = await db.collection(`${prefix}/notes/note/presence`).get();
  assert.equal(leases.size, 1);
  const lease = leases.docs[0].data();
  assert.equal(lease.uid, "member");
  assert.equal(lease.displayName, "Member");
  assert.ok(lease.expiresAt.toMillis() > Date.now() + 80000);
  assert.equal(
    (
      await api("outsider", "POST", `${prefix}/notes/note/presence`, {
        sessionId,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes/note/presence`, {
        sessionId,
        uid: "owner",
      })
    ).status,
    400,
  );
  const op = editOperation(note, (c) => {
    c.blocks[0].text = "Ack before removal";
  });
  assert.equal((await sendOperation("member", op)).status, 200);
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/notes/note`)).status,
    200,
  );
  assert.equal(
    (await db.collection(`${prefix}/notes/note/presence`).get()).size,
    0,
  );
  assert.equal(
    (await db.collection(`${prefix}/notes/note/collaborationReceipts`).get())
      .size,
    0,
  );
  assert.equal((await sendOperation("member", op)).status, 404);
  assert.equal((await db.doc(`${prefix}/notes/note`).get()).exists, false);
  op.doc.destroy();
});

test("malformed CRDT schema and oversized updates fail without a checkpoint or receipt", async () => {
  const note = await promoted();
  const doc = decodeDocument(note.collab.state),
    vector = Y.encodeStateVector(doc);
  doc.getMap("unexpected").set("data", "untrusted");
  const operationId = randomUUID();
  const request = {
    operationId,
    generation: note.collab.generation,
    update: toBase64(Y.encodeStateAsUpdate(doc, vector)),
  };
  assert.equal(
    (await api("member", "POST", `${prefix}/notes/note/updates`, request))
      .status,
    400,
  );
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes/note/updates`, {
        ...request,
        operationId: randomUUID(),
        update: Buffer.alloc(64001).toString("base64"),
      })
    ).status,
    400,
  );
  assert.deepEqual((await currentNote()).collab, note.collab);
  assert.equal(
    (await db.collection(`${prefix}/notes/note/collaborationReceipts`).get())
      .size,
    0,
  );
  doc.destroy();
});

test("simultaneous retries of the same operation have exactly one durable receipt and sequence", async () => {
  const note = await promoted();
  const op = editOperation(note, (c) => {
    c.blocks[0].text = "Retry once";
  });
  for (const response of await Promise.all([
    sendOperation("member", op),
    sendOperation("member", op),
  ]))
    assert.equal(response.status, 200, JSON.stringify(response.data));
  const state = await currentNote();
  assert.equal(state.collab.sequence, 1);
  assert.equal(state.content.blocks[0].text, "Retry once");
  assert.equal(
    (await db.collection(`${prefix}/notes/note/collaborationReceipts`).get())
      .size,
    1,
  );
  op.doc.destroy();
});

test("failed collaboration cleanup leaves a fenced parent and deletion is retryable", async () => {
  const note = await promoted(),
    sessionId = randomUUID();
  assert.equal(
    (
      await api("member", "POST", `${prefix}/notes/note/presence`, {
        sessionId,
      })
    ).status,
    200,
  );
  const op = editOperation(note, (c) => {
    c.blocks[0].text = "Durable before delete";
  });
  assert.equal((await sendOperation("member", op)).status, 200);
  const recursiveDelete = db.recursiveDelete;
  db.recursiveDelete = async function (ref, ...args) {
    if (ref.id === "presence")
      throw new Error("Simulated operational cleanup failure");
    return recursiveDelete.call(this, ref, ...args);
  };
  try {
    assert.equal(
      (await api("owner", "DELETE", `${prefix}/notes/note`)).status,
      500,
    );
  } finally {
    db.recursiveDelete = recursiveDelete;
  }
  const pending = await currentNote();
  assert.equal(pending.deleting, true);
  assert.equal((await sendOperation("member", op)).data.error.code, "deleting");
  assert.equal(
    (await api("owner", "DELETE", `${prefix}/notes/note`)).status,
    200,
  );
  assert.equal((await db.doc(`${prefix}/notes/note`).get()).exists, false);
  assert.equal(
    (await db.collection(`${prefix}/notes/note/presence`).get()).size,
    0,
  );
  op.doc.destroy();
});
