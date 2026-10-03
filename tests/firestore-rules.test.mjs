import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc, setLogLevel, updateDoc } from "firebase/firestore";
import { deleteObject, getBytes, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";

let environment;
setLogLevel("silent");
const workspace = "workspaces/alpha";
const documents = [workspace, `${workspace}/members/member`, `${workspace}/tasks/task`, `${workspace}/notes/note`, `${workspace}/attachments/file`];

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Use npm run test:rules to start isolated emulators");
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "Storage emulator must be running");
  environment = await initializeTestEnvironment({
    projectId: "demo-teamspace",
    firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8") },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, workspace), { name: "Alpha", ownerId: "owner" }),
      setDoc(doc(db, `${workspace}/members/owner`), { role: "owner" }),
      setDoc(doc(db, `${workspace}/members/member`), { role: "member" }),
      setDoc(doc(db, `${workspace}/tasks/task`), { title: "Task", status: "todo" }),
      setDoc(doc(db, `${workspace}/notes/note`), { title: "Note", revision: 1 }),
      setDoc(doc(db, `${workspace}/attachments/file`), { parentType: "task", parentId: "task" }),
      setDoc(doc(db, "users/member"), { displayName: "Member" }),
      setDoc(doc(db, "users/outsider"), { displayName: "Outsider" }),
      setDoc(doc(db, "users/member/workspaces/alpha"), { workspaceId: "alpha" }),
      setDoc(doc(db, "invites/hash"), { workspaceId: "alpha", uses: 0 }),
      setDoc(doc(db, "rateLimits/member-minute"), { count: 1 }),
      setDoc(doc(db, "internal/private"), { count: 1 }),
    ]);
  });
});

after(async () => { if (environment) await environment.cleanup(); });

test("members and owners can read each workspace document and subcollection", async () => {
  for (const uid of ["member", "owner"]) {
    const db = environment.authenticatedContext(uid).firestore();
    for (const path of documents) await assertSucceeds(getDoc(doc(db, path)));
    for (const name of ["members", "tasks", "notes", "attachments"]) {
      await assertSucceeds(getDocs(collection(db, `${workspace}/${name}`)));
    }
  }
});

test("anonymous and nonmembers cannot read workspace documents or query content", async () => {
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("outsider")]) {
    const db = context.firestore();
    for (const path of documents) await assertFails(getDoc(doc(db, path)));
    for (const name of ["members", "tasks", "notes", "attachments"]) {
      await assertFails(getDocs(collection(db, `${workspace}/${name}`)));
    }
  }
});

test("all clients including owners are denied create, update, and delete", async () => {
  for (const uid of [null, "member", "owner", "outsider"]) {
    const context = uid === null ? environment.unauthenticatedContext() : environment.authenticatedContext(uid);
    const db = context.firestore();
    for (const path of [...documents, "users/member", "invites/hash"]) {
      await assertFails(setDoc(doc(db, path), { forged: true }));
      await assertFails(updateDoc(doc(db, path), { forged: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(setDoc(doc(db, `${workspace}/members/${uid ?? "anonymous"}`), { role: "owner" }));
    await assertFails(setDoc(doc(db, "workspaces/forged"), { ownerId: uid }));
  }
});

test("profile access is self-only and global lists and collection groups are denied", async () => {
  const db = environment.authenticatedContext("member").firestore();
  await assertSucceeds(getDoc(doc(db, "users/member")));
  await assertFails(getDoc(doc(db, "users/outsider")));
  await assertFails(getDocs(collection(db, "users")));
  await assertFails(getDocs(collection(db, "workspaces")));
  await assertFails(getDocs(collectionGroup(db, "tasks")));
  await assertFails(getDocs(collectionGroup(db, "members")));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "users/member")));
});

test("invitations and unknown paths stay inaccessible even to owners", async () => {
  for (const uid of ["owner", "member", "outsider"]) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, "invites/hash")));
    await assertFails(getDocs(collection(db, "invites")));
    await assertFails(getDoc(doc(db, "rateLimits/member-minute")));
    await assertFails(setDoc(doc(db, "rateLimits/member-minute"), { count: 0 }));
    await assertFails(getDoc(doc(db, "users/member/workspaces/alpha")));
    await assertFails(setDoc(doc(db, "users/member/workspaces/alpha"), { role: "owner" }));
    await assertFails(getDoc(doc(db, "internal/private")));
    await assertFails(setDoc(doc(db, `${workspace}/unexpected/doc`), { data: "private" }));
    await assertFails(getDoc(doc(db, `${workspace}/unexpected/doc`)));
  }
});

test("revoking membership immediately denies subsequent content reads", async () => {
  const db = environment.authenticatedContext("member").firestore();
  await assertSucceeds(getDoc(doc(db, `${workspace}/tasks/task`)));
  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), `${workspace}/members/member`));
  });
  await assertFails(getDoc(doc(db, `${workspace}/tasks/task`)));
  await assertFails(getDocs(collection(db, `${workspace}/notes`)));
});

test("private Storage objects cannot be read or written by any browser", async () => {
  const path = "workspaces/alpha/task/task/file/image.png";
  await environment.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), new Uint8Array([1, 2, 3]), { contentType: "image/png" });
  });
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("owner"), environment.authenticatedContext("member"), environment.authenticatedContext("outsider")]) {
    const object = ref(context.storage(), path);
    await assertFails(getMetadata(object));
    await assertFails(getBytes(object));
    await assertFails(listAll(ref(context.storage(), "workspaces/alpha")));
    await assertFails(uploadBytes(object, new Uint8Array([4]), { contentType: "image/png" }));
    await assertFails(deleteObject(object));
  }
});
