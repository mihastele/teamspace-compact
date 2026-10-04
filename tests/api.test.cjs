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
const { firebaseDocumentStore } = require("../.test-build/server/document-store.js");
const { guardedDocumentStore } = require("../.test-build/server/auth-policy.js");
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
  const response = await handleTrustedApi(
    request,
    path.split("?")[0].split("/"),
    {
      db,
      storage: storageOverride,
      user: { uid, name: uid },
      resolveAccount: async account => account === "missing@example.test" ? null : ({ uid: account.includes("@") ? "new-user" : account, displayName: "Registered user", photoURL: null }),
    },
  );
  return { status: response.status, data: await response.json() };
}
const prefix = "workspaces/alpha";

test("workspace admins manage ordinary members but cannot elevate themselves or remove owners/admins", async () => {
  assert.equal((await api("member", "PATCH", `${prefix}/members/member`, {role:"admin"})).status,403);
  assert.equal((await api("owner", "PATCH", `${prefix}/members/member`, {role:"admin"})).status,200);
  assert.equal((await api("member", "POST", `${prefix}/invites`, {})).status,201);
  assert.equal((await api("member", "PATCH", `${prefix}/members/member`, {role:"member"})).status,403);
  assert.equal((await api("member", "DELETE", `${prefix}/members/owner`)).status,409);
  await db.doc(`${prefix}/members/admin2`).set({role:"admin",displayName:"Other admin"});
  assert.equal((await api("member", "DELETE", `${prefix}/members/admin2`)).status,403);
  assert.equal((await api("owner", "PATCH", `${prefix}/members/owner`, {role:"member"})).status,409);
  assert.equal((await api("owner", "PATCH", `${prefix}/members/member`, {role:"root"})).status,400);
});

test("root authorization is server-configured and does not grant content access", async () => {
  const previous=process.env.ROOT_ADMIN_UIDS;
  try {
    process.env.ROOT_ADMIN_UIDS="outsider";
    assert.equal((await api("outsider","GET","administration/workspaces")).status,200);
    assert.equal((await api("member","GET","administration/workspaces")).status,403);
    assert.equal((await api("outsider","PATCH",`${prefix}/members/member`,{role:"admin"})).status,200);
    assert.equal((await api("outsider","GET",`${prefix}/snapshot`)).status,403);
    assert.equal((await api("outsider","GET",`${prefix}/members`)).status,200);
  } finally { if(previous===undefined)delete process.env.ROOT_ADMIN_UIDS;else process.env.ROOT_ADMIN_UIDS=previous; }
});

test("direct registered addition is atomic, duplicate-safe and stale retries cannot undo removal", async () => {
  const input={account:"new@example.test",operationId:require("node:crypto").randomUUID()};
  assert.equal((await api("member","POST",`${prefix}/members`,input)).status,403);
  const results=await Promise.all([api("owner","POST",`${prefix}/members`,input),api("owner","POST",`${prefix}/members`,input)]);
  assert.ok(results.every(result=>result.status===200));
  assert.equal((await db.collection(`${prefix}/membershipOperations`).get()).size,1);
  assert.equal((await db.doc("users/new-user/workspaces/alpha").get()).exists,true);
  assert.equal((await db.doc(`${prefix}/members/new-user`).get()).data().role,"member");
  assert.equal((await api("owner","POST",`${prefix}/members`,{...input,account:"different@example.test"})).status,409);
  assert.equal((await api("owner","DELETE",`${prefix}/members/new-user`)).status,200);
  assert.equal((await api("owner","POST",`${prefix}/members`,input)).data.removed,true);
  assert.equal((await db.doc(`${prefix}/members/new-user`).get()).exists,false);
  assert.equal((await db.doc("users/new-user/workspaces/alpha").get()).exists,false);
});

test("direct addition preserves an existing owner/admin and rejects missing accounts and mass assignment", async () => {
  const input={account:"owner",operationId:require("node:crypto").randomUUID()};
  assert.equal((await api("owner","POST",`${prefix}/members`,input)).status,200);
  assert.equal((await db.doc(`${prefix}/members/owner`).get()).data().role,"owner");
  assert.equal((await api("owner","POST",`${prefix}/members`,{...input,operationId:require("node:crypto").randomUUID(),account:"missing@example.test"})).status,404);
  assert.equal((await api("owner","POST",`${prefix}/members`,{...input,role:"owner"})).status,400);
});

test("development enrollment is atomic and once-only even after removal; production rejects it", async () => {
  const previous={NODE_ENV:process.env.NODE_ENV,DEV_AUTO_JOIN_WORKSPACE_ID:process.env.DEV_AUTO_JOIN_WORKSPACE_ID};
  try {
    process.env.NODE_ENV="development";process.env.DEV_AUTO_JOIN_WORKSPACE_ID="alpha";
    // Removal must prevent enrollment even before the first bootstrap call.
    await api("owner","DELETE",`${prefix}/members/member`);
    assert.equal((await api("member","POST","access/bootstrap",{})).status,200);
    assert.equal((await db.doc(`${prefix}/members/member`).get()).exists,false);
    const results=await Promise.all([api("outsider","POST","access/bootstrap",{}),api("outsider","POST","access/bootstrap",{})]);
    assert.ok(results.every(result=>result.status===200));
    assert.equal((await db.doc(`${prefix}/members/outsider`).get()).exists,true);
    assert.equal((await db.doc("users/outsider/developmentEnrollments/alpha").get()).exists,true);
    await api("owner","DELETE",`${prefix}/members/outsider`);
    assert.equal((await api("outsider","POST","access/bootstrap",{})).status,200);
    assert.equal((await db.doc(`${prefix}/members/outsider`).get()).exists,false);
    process.env.NODE_ENV="production";
    assert.equal((await api("outsider","POST","access/bootstrap",{})).status,503);
    delete process.env.DEV_AUTO_JOIN_WORKSPACE_ID;
    assert.equal((await api("outsider","POST","access/bootstrap",{})).status,200);
    assert.equal((await db.doc(`${prefix}/members/outsider`).get()).exists,false);
  } finally {for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

test("member limit applies to direct additions and development enrollment", async () => {
  const batch=db.batch();for(let i=0;i<100;i++)batch.set(db.doc(`users/new-user/workspaces/w${i}`),{});await batch.commit();
  assert.equal((await api("owner","POST",`${prefix}/members`,{account:"new-user",operationId:require("node:crypto").randomUUID()})).status,409);
  assert.equal((await db.doc(`${prefix}/members/new-user`).get()).exists,false);
  assert.equal((await db.collection(`${prefix}/membershipOperations`).get()).size,0);
});

test("owner transfer during account resolution prevents a stale administrator grant",async()=>{
  let lookups=0;
  const request=new Request(`http://localhost/api/${prefix}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'new-user',operationId:require('node:crypto').randomUUID()})});
  const response=await handleTrustedApi(request,[...prefix.split('/'),'members'],{db,storage,user:{uid:'owner'},resolveAccount:async()=>{
    lookups++;await api('owner','PATCH',`${prefix}/owner`,{uid:'member'});
    return {uid:'new-user',displayName:'New user',photoURL:null};
  }});
  assert.equal(lookups,1);assert.equal(response.status,403);
  assert.equal((await db.doc(`${prefix}/members/new-user`).get()).exists,false);
  assert.equal((await db.collection(`${prefix}/membershipOperations`).get()).size,0);
});
test('Firebase transactions serialize durable writes with email policy changes', async () => {
  await db.doc('security/policy').set({emailConfirmationRequired:false});
  const portable=firebaseDocumentStore(db), guarded=guardedDocumentStore(portable,false,false);
  let release,read;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{read=resolve;});
  const operation=guarded.runTransaction(async tx=>{await tx.get(portable.doc(`${prefix}/tasks/task`));read();await gate;tx.update(portable.doc(`${prefix}/tasks/task`),{title:'Authorized before tightening'});});
  await ready;
  // Firestore locks transaction reads. Release the pending writer while its queued
  // policy update is competing, then verify later transactions obey the new policy.
  const tightening=db.doc('security/policy').set({emailConfirmationRequired:true});
  release();
  const [written,published]=await Promise.allSettled([operation,tightening]);
  assert.equal(published.status,'fulfilled');
  if(written.status==='rejected')assert.equal(written.reason.code,'policy_mismatch');
  await assert.rejects(guarded.runTransaction(async tx=>tx.update(portable.doc(`${prefix}/tasks/task`),{title:'Denied'})),error=>error.code==='policy_mismatch');
  assert.equal((await db.doc(`${prefix}/tasks/task`).get()).data().title,written.status==='fulfilled'?'Authorized before tightening':'Original');
});

test("conversations preserve concurrent posts and acknowledge exact retry identities", async () => {
  const path = `${prefix}/notes/note/comments`;
  const packet = {
    operationId: randomUUID(),
    body: "Hello @{member} and @{member}",
  };
  const [a, b] = await Promise.all([
    api("owner", "POST", path, packet),
    api("member", "POST", path, { operationId: randomUUID(), body: "Reply" }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.data.comment.id, b.data.comment.id);
  assert.deepEqual(a.data.comment.mentions, [
    { uid: "member", displayName: "Member" },
  ]);
  assert.equal(a.data.comment.authorId, "owner");
  assert.equal(a.data.comment.authorName, "owner");
  assert.equal(typeof a.data.comment.createdAt, "number");
  assert.deepEqual(
    (await api("owner", "POST", path, packet)).data.comment,
    a.data.comment,
  );
  assert.equal(
    (await api("owner", "POST", path, { ...packet, body: "Different" })).status,
    409,
  );
  assert.equal((await db.collection(path).get()).size, 2);
});

test("conversation input membership and deletion authorization reject impersonation", async () => {
  const path = `${prefix}/tasks/task/comments`;
  for (const packet of [
    { operationId: randomUUID(), body: "" },
    { operationId: randomUUID(), body: "x".repeat(4001) },
    { operationId: randomUUID(), body: "x\u0000" },
    { operationId: randomUUID(), body: "Pretend", authorId: "owner" },
    { operationId: randomUUID(), body: "@{outsider}" },
    { operationId: randomUUID(), body: "@{bad/id}" },
  ])
    assert.equal((await api("member", "POST", path, packet)).status, 400);
  assert.equal(
    (
      await api("outsider", "POST", path, {
        operationId: randomUUID(),
        body: "Attack",
      })
    ).status,
    403,
  );
  const created = await api("member", "POST", path, {
    operationId: randomUUID(),
    body: "Mine",
  });
  assert.equal(created.status, 200);
  assert.equal(
    (await api("owner", "DELETE", `${path}/${created.data.comment.id}`)).status,
    403,
  );
  await db.doc(`${prefix}/members/member`).delete();
  assert.equal(
    (await api("member", "DELETE", `${path}/${created.data.comment.id}`))
      .status,
    403,
  );
  assert.equal(
    (await db.doc(`${path}/${created.data.comment.id}`).get()).data().body,
    "Mine",
  );
});

test("comment tombstones erase content and replay cannot resurrect it after mention removal", async () => {
  const path = `${prefix}/tasks/task/comments`;
  const packet = { operationId: randomUUID(), body: "Ping @{member}" };
  const created = await api("owner", "POST", path, packet);
  const id = created.data.comment.id;
  assert.equal((await api("owner", "DELETE", `${path}/${id}`)).status, 200);
  await db.doc(`${prefix}/members/member`).delete();
  const replay = await api("owner", "POST", path, packet);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.comment.deleted, true);
  assert.equal(replay.data.comment.body, "");
  assert.deepEqual(replay.data.comment.mentions, []);
  assert.equal((await api("owner", "DELETE", `${path}/${id}`)).status, 200);
  assert.equal((await db.collection(path).get()).size, 1);
});

test("parent deletion races cannot orphan or resurrect page or task comments", async () => {
  for (const [resource, id] of [
    ["notes", "note"],
    ["tasks", "task"],
  ]) {
    const parent = `${prefix}/${resource}/${id}`;
    const results = await Promise.all([
      api("member", "POST", `${parent}/comments`, {
        operationId: randomUUID(),
        body: "Racing",
      }),
      api("owner", "DELETE", parent),
    ]);
    assert.ok([200, 404, 409].includes(results[0].status));
    assert.equal(results[1].status, 200);
    assert.equal((await db.doc(parent).get()).exists, false);
    assert.equal((await db.collection(`${parent}/comments`).get()).size, 0);
    assert.equal(
      (
        await api("member", "POST", `${parent}/comments`, {
          operationId: randomUUID(),
          body: "Late",
        })
      ).status,
      404,
    );
  }
});

test("history restores preserve conversations and failed cleanup remains fenced and retryable", async () => {
  const parent = `${prefix}/notes/note`;
  const created = await api("member", "POST", `${parent}/comments`, {
    operationId: randomUUID(),
    body: "Still here",
  });
  assert.equal(
    (
      await api("owner", "POST", `${parent}/history`, {
        expectedRevision: 1,
        name: "Original",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("owner", "POST", `${parent}/restore`, {
        expectedRevision: 1,
        versionId: "r1",
        operationId: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.doc(`${parent}/comments/${created.data.comment.id}`).get()).data()
      .body,
    "Still here",
  );
  const original = db.recursiveDelete;
  db.recursiveDelete = async function (ref, ...args) {
    if (ref.id === "comments")
      throw new Error("Simulated comments cleanup failure");
    return original.call(this, ref, ...args);
  };
  try {
    assert.equal((await api("owner", "DELETE", parent)).status, 500);
  } finally {
    db.recursiveDelete = original;
  }
  assert.equal((await db.doc(parent).get()).data().deleting, true);
  assert.equal(
    (
      await api("member", "POST", `${parent}/comments`, {
        operationId: randomUUID(),
        body: "Blocked",
      })
    ).status,
    409,
  );
  assert.equal((await api("owner", "DELETE", parent)).status, 200);
  assert.equal((await db.collection(`${parent}/comments`).get()).size, 0);
});

test("conversation posting limits are server enforced and mention count is bounded", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const path = `${prefix}/tasks/task/comments`;
  await Promise.all(
    Array.from({ length: 11 }, (_, i) =>
      db
        .doc(`${prefix}/members/u${i}`)
        .set({ role: "member", displayName: `User ${i}` }),
    ),
  );
  const tooMany = Array.from({ length: 11 }, (_, i) => `@{u${i}}`).join(" ");
  assert.equal(
    (
      await api("member", "POST", path, {
        operationId: randomUUID(),
        body: tooMany,
      })
    ).status,
    400,
  );
  for (let i = 0; i < 19; i++)
    assert.equal(
      (
        await api("member", "POST", path, {
          operationId: randomUUID(),
          body: `Message ${i}`,
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await api("member", "POST", path, {
        operationId: randomUUID(),
        body: "Excess",
      })
    ).status,
    429,
  );
  assert.equal((await db.collection(path).get()).size, 19);
});

test("history checkpoints capture initial saved state and five-minute cadence with immutable naming", async () => {
  const created = await api("member", "POST", `${prefix}/notes`, {
    title: "Start",
    content: { blocks: [] },
  });
  assert.equal(created.status, 201);
  const path = `${prefix}/notes/${created.data.note.id}`;
  assert.equal(
    (await api("owner", "GET", `${path}/history`)).data.versions[0]
      .sourceRevision,
    1,
  );
  await api("member", "PATCH", path, {
    title: "Quick",
    content: { blocks: [] },
    expectedRevision: 1,
  });
  assert.equal(
    (await api("owner", "GET", `${path}/history`)).data.versions.length,
    1,
  );
  await db
    .doc(path)
    .update({ historyCheckpointAt: Timestamp.fromMillis(Date.now() - 300001) });
  await api("owner", "PATCH", path, {
    title: "Checkpoint",
    content: { blocks: [{ type: "paragraph", text: "Saved" }] },
    expectedRevision: 2,
  });
  const list = await api("member", "GET", `${path}/history`);
  assert.deepEqual(
    list.data.versions.map((v) => v.sourceRevision),
    [3, 1],
  );
  assert.ok(!Object.hasOwn(list.data.versions[0], "content"));
  assert.equal(
    (
      await api("member", "POST", `${path}/history`, {
        expectedRevision: 3,
        name: "Release",
      })
    ).status,
    200,
  );
  await api("member", "PATCH", path, {
    title: "Newer",
    content: { blocks: [] },
    expectedRevision: 3,
  });
  assert.equal(
    (
      await api("member", "POST", `${path}/history`, {
        expectedRevision: 3,
        name: "Release",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("owner", "POST", `${path}/history`, {
        expectedRevision: 3,
        name: "Different",
      })
    ).status,
    409,
  );
  const version = (await api("member", "GET", `${path}/history?version=r3`))
    .data.version;
  assert.equal(version.title, "Checkpoint");
  assert.equal(version.kind, "named");
  assert.equal(version.expiresAt, null);
  assert.equal(version.content.blocks[0].text, "Saved");
});

test("history API hides expired snapshots before TTL deletion and paginates bounded scans", async () => {
  const path = `${prefix}/notes/note`;
  await Promise.all(
    Array.from({ length: 23 }, (_, i) =>
      db.doc(`${path}/historyVersions/r${i + 1}`).set({
        sourceRevision: i + 1,
        title: "Old",
        content: { blocks: [] },
        kind: "checkpoint",
        name: null,
        capturedAt: Timestamp.now(),
        capturedBy: "member",
        capturedName: "Member",
        expiresAt: Timestamp.fromMillis(Date.now() - 1),
      }),
    ),
  );
  const page = await api("member", "GET", `${path}/history`);
  assert.equal(page.status, 200);
  assert.deepEqual(page.data.versions, []);
  assert.equal(page.data.nextBefore, 4);
  assert.equal(
    (await api("member", "GET", `${path}/history?before=4`)).data.nextBefore,
    null,
  );
  assert.equal(
    (await api("member", "GET", `${path}/history?version=r23`)).status,
    404,
  );
  assert.equal(
    (
      await api("member", "POST", `${path}/restore`, {
        versionId: "r23",
        expectedRevision: 1,
        operationId: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal((await currentNote()).revision, 1);
});

test("restore preserves hierarchy attachments and tasks; backs up current state and fences stale generations", async () => {
  const note = await promoted();
  const path = `${prefix}/notes/note`;
  await api("member", "POST", `${path}/history`, {
    expectedRevision: note.revision,
    name: "Original",
  });
  await db.doc(path).update({ historyCheckpointAt: Timestamp.now() });
  const edit = editOperation(note, (c) => {
    c.blocks[0].text = "Changed";
  });
  assert.equal((await sendOperation("member", edit)).status, 200);
  edit.doc.destroy();
  await db.doc(path).update({ parentId: "parent" });
  await db.doc(`${prefix}/notes/child`).set({
    parentId: "note",
    title: "Child",
    content: { blocks: [] },
    revision: 1,
  });
  await db
    .doc(`${prefix}/attachments/file`)
    .set({ parentType: "note", parentId: "note", status: "ready" });
  const current = await currentNote();
  const operationId = randomUUID();
  const request = {
    versionId: `r${note.revision}`,
    expectedRevision: current.revision,
    operationId,
  };
  const response = await api("owner", "POST", `${path}/restore`, request);
  assert.equal(response.status, 200);
  const restored = response.data.note;
  assert.equal(restored.parentId, "parent");
  assert.equal(restored.content.blocks[0].text, "Alpha");
  assert.notEqual(restored.collab.generation, note.collab.generation);
  assert.equal(restored.collab.sequence, 0);
  const backup = (
    await api("member", "GET", `${path}/history?version=r${current.revision}`)
  ).data.version;
  assert.equal(backup.content.blocks[0].text, "Changed");
  assert.equal(backup.kind, "before_restore");
  assert.ok((await db.doc(`${prefix}/attachments/file`).get()).exists);
  assert.equal(
    (await db.doc(`${prefix}/notes/child`).get()).data().parentId,
    "note",
  );
  assert.equal(
    (await db.doc(`${prefix}/tasks/task`).get()).data().title,
    "Original",
  );
  const stale = editOperation(note, (c) => {
    c.blocks[1].text = "Stale";
  });
  assert.equal((await sendOperation("member", stale)).status, 409);
  stale.doc.destroy();
  const newer = editOperation(restored, (c) => {
    c.blocks[1].text = "After restore";
  });
  assert.equal((await sendOperation("member", newer)).status, 200);
  newer.doc.destroy();
  const replay = await api("owner", "POST", `${path}/restore`, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.note.content.blocks[1].text, "After restore");
  assert.equal(replay.data.note.revision, restored.revision + 1);
  assert.equal(
    (
      await api("owner", "POST", `${path}/restore`, {
        ...request,
        versionId: `r${current.revision}`,
      })
    ).status,
    409,
  );
});

test("competing restores use global CAS and cannot overwrite concurrent acknowledged work", async () => {
  const path = `${prefix}/notes/note`;
  await api("member", "POST", `${path}/history`, {
    expectedRevision: 1,
    name: "Named",
  });
  const responses = await Promise.all(
    ["member", "owner"].map((uid) =>
      api(uid, "POST", `${path}/restore`, {
        versionId: "r1",
        expectedRevision: 1,
        operationId: randomUUID(),
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await currentNote()).revision, 2);
  assert.equal((await db.collection(`${path}/historyRestores`).get()).size, 1);
  assert.equal(
    (await db.doc(`${path}/historyVersions/r1`).get()).data().expiresAt,
    null,
  );
});

test("history authorization is rechecked and fenced deletion removes snapshots and restore receipts", async () => {
  const path = `${prefix}/notes/note`;
  await api("member", "POST", `${path}/history`, {
    expectedRevision: 1,
    name: "Named",
  });
  for (const [method, suffix, input] of [
    ["GET", "history"],
    ["GET", "history?version=r1"],
    ["POST", "history", { expectedRevision: 1, name: "Attack" }],
    [
      "POST",
      "restore",
      { expectedRevision: 1, versionId: "r1", operationId: randomUUID() },
    ],
  ])
    assert.equal(
      (await api("outsider", method, `${path}/${suffix}`, input)).status,
      403,
    );
  await api("owner", "POST", `${path}/restore`, {
    expectedRevision: 1,
    versionId: "r1",
    operationId: randomUUID(),
  });
  await db.doc(`${prefix}/members/member`).delete();
  assert.equal((await api("member", "GET", `${path}/history`)).status, 403);
  assert.equal((await api("owner", "DELETE", path)).status, 200);
  assert.equal((await db.collection(`${path}/historyVersions`).get()).size, 0);
  assert.equal((await db.collection(`${path}/historyRestores`).get()).size, 0);
  assert.equal((await api("owner", "GET", `${path}/history`)).status, 404);
});

test("collaborative content and metadata saves checkpoint their acknowledged materialized state", async () => {
  const note = await promoted();
  const path = `${prefix}/notes/note`;
  const edit = editOperation(note, (content) => {
    content.blocks[0].text = "Collaborative checkpoint";
  });
  const response = await sendOperation("member", edit);
  edit.doc.destroy();
  assert.equal(response.status, 200);
  const revision = response.data.note.revision;
  assert.equal(
    (await api("owner", "GET", `${path}/history?version=r${revision}`)).data
      .version.content.blocks[0].text,
    "Collaborative checkpoint",
  );
  await db
    .doc(path)
    .update({ historyCheckpointAt: Timestamp.fromMillis(Date.now() - 300001) });
  const metadata = await api("owner", "PATCH", `${path}/metadata`, {
    title: "Renamed",
    expectedRevision: note.metadataRevision,
  });
  assert.equal(metadata.status, 200);
  const version = (
    await api(
      "member",
      "GET",
      `${path}/history?version=r${metadata.data.note.revision}`,
    )
  ).data.version;
  assert.equal(version.title, "Renamed");
  assert.equal(version.content.blocks[0].text, "Collaborative checkpoint");
});

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

test("status-only quick moves preserve concurrent teammate edits", async () => {
  const before = (await db.doc(`${prefix}/tasks/task`).get()).data();
  const results = await Promise.all([
    api("member", "PATCH", `${prefix}/tasks/task`, { status: "doing" }),
    api("owner", "PATCH", `${prefix}/tasks/task`, {
      title: "Updated by teammate",
      description: "Concurrent detail",
      dueDate: "2026-10-10",
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  const final = (await db.doc(`${prefix}/tasks/task`).get()).data();
  assert.equal(final.status, "doing");
  assert.equal(final.title, "Updated by teammate");
  assert.equal(final.description, "Concurrent detail");
  assert.equal(final.dueDate, "2026-10-10");
  assert.equal(final.position, before.position);
  assert.equal(final.createdBy, before.createdBy);
  assert.equal(
    (await api("member", "PATCH", `${prefix}/tasks/task`, { status: "doing" }))
      .status,
    200,
  );
  assert.equal(
    (await db.doc(`${prefix}/tasks/task`).get()).data().description,
    "Concurrent detail",
  );
});

test("quick moves cannot recreate a missing task", async () => {
  assert.equal(
    (
      await api("member", "PATCH", `${prefix}/tasks/deleted`, {
        status: "done",
      })
    ).status,
    404,
  );
  assert.equal((await db.doc(`${prefix}/tasks/deleted`).get()).exists, false);
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
