import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  initializeDocument,
  decodeDocument,
  encodeDocument,
  readContent,
  validateDocument,
  fromBase64,
  MAX_UPDATE_BYTES,
} from "../collaboration-model";
import {
  FieldValue,
  Timestamp,
  type Firestore,
  type Transaction,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Storage } from "firebase-admin/storage";
import sharp from "sharp";
import { firebaseAdmin } from "./firebase";
import {
  ApiError,
  identifier,
  integer,
  noteContent,
  object,
  taskInput,
  text,
  uuid,
} from "./validation";

const MAX_BYTES = 10 * 1024 * 1024;
const now = () => FieldValue.serverTimestamp();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "invalid_input", "Use application/json.");
  if (Number(request.headers.get("content-length")) > 600000)
    throw new ApiError(413, "too_large", "Request exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "invalid_input", "Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 600000) {
      await reader.cancel();
      throw new ApiError(413, "too_large", "Request exceeds the size limit.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "invalid_input", "Invalid JSON.");
  }
}

async function rateLimit(
  db: Firestore,
  uid: string,
  scope: string,
  limit: number,
) {
  const minute = Math.floor(Date.now() / 60000);
  const ref = db.doc(`rateLimits/${hash(`${uid}:${scope}:${minute}`)}`);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = snapshot.data()?.count ?? 0;
    if (count >= limit)
      throw new ApiError(
        429,
        "rate_limited",
        "Too many requests. Try again in one minute.",
      );
    tx.set(ref, {
      count: count + 1,
      expiresAt: Timestamp.fromMillis((minute + 2) * 60000),
    });
  });
}

async function member(
  tx: Transaction,
  workspace: DocumentReference,
  uid: string,
  owner = false,
) {
  const [space, membership] = await Promise.all([
    tx.get(workspace),
    tx.get(workspace.collection("members").doc(uid)),
  ]);
  if (!space.exists || !membership.exists)
    throw new ApiError(
      403,
      "forbidden",
      "You do not have access to this workspace.",
    );
  if (
    owner &&
    (space.data()?.ownerId !== uid || membership.data()?.role !== "owner")
  )
    throw new ApiError(
      403,
      "forbidden",
      "Only the workspace owner can do this.",
    );
  return space;
}

async function authenticate(request: Request) {
  const { auth, db, storage } = firebaseAdmin();
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match)
    throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  let user: DecodedIdToken;
  try {
    user = await auth.verifyIdToken(match[1], true);
  } catch {
    throw new ApiError(
      401,
      "unauthenticated",
      "Your session has expired. Sign in again.",
    );
  }
  await rateLimit(db, user.uid, "api", 120);
  return { db, storage, user };
}

async function workspaceList(db: Firestore, uid: string) {
  const memberships = await db
    .collection(`users/${uid}/workspaces`)
    .limit(100)
    .get();
  const workspaces = await Promise.all(
    memberships.docs.map(async (membership) => {
      const ref = db.doc(`workspaces/${membership.id}`);
      const [workspace, currentMember] = await Promise.all([
        ref.get(),
        ref.collection("members").doc(uid).get(),
      ]);
      if (!workspace.exists || !currentMember.exists) return null;
      const data = workspace.data()!;
      return { id: workspace.id, name: data.name, ownerId: data.ownerId };
    }),
  );
  return json({ workspaces: workspaces.filter(Boolean) });
}

async function createWorkspace(
  db: Firestore,
  user: DecodedIdToken,
  input: unknown,
) {
  await rateLimit(db, user.uid, "workspace_create", 5);
  const data = object(input, ["name"]);
  const name = text(data.name, "Workspace name", 80);
  const ref = db.collection("workspaces").doc();
  await db.runTransaction(async (tx) => {
    const [index, profile] = await Promise.all([
      tx.get(db.collection(`users/${user.uid}/workspaces`)),
      tx.get(db.doc(`users/${user.uid}`)),
    ]);
    if (index.size >= 100)
      throw new ApiError(
        409,
        "workspace_limit",
        "You can belong to at most 100 workspaces.",
      );
    tx.create(ref, { name, ownerId: user.uid, createdAt: now() });
    tx.create(ref.collection("members").doc(user.uid), {
      role: "owner",
      displayName: displayName(user),
      joinedAt: now(),
    });
    tx.create(db.doc(`users/${user.uid}/workspaces/${ref.id}`), {
      joinedAt: now(),
    });
    tx.set(
      db.doc(`users/${user.uid}`),
      {
        displayName: displayName(user),
        photoURL: user.picture ?? null,
        createdAt: profile.data()?.createdAt ?? now(),
        updatedAt: now(),
      },
      { merge: true },
    );
  });
  return json({ workspace: { id: ref.id, name, ownerId: user.uid } }, 201);
}
function displayName(user: DecodedIdToken) {
  return typeof user.name === "string" ? user.name.slice(0, 100) : "Teammate";
}

async function redeemInvite(
  db: Firestore,
  user: DecodedIdToken,
  input: unknown,
) {
  await rateLimit(db, user.uid, "invite_redeem", 10);
  const data = object(input, ["token"]);
  const token = text(data.token, "Invitation token", 100);
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token))
    throw new ApiError(400, "invalid_invite", "This invitation is invalid.");
  const ref = db.doc(`invites/${hash(token)}`);
  const workspace = await db.runTransaction(async (tx) => {
    const invite = await tx.get(ref);
    const info = invite.data();
    if (
      !info ||
      info.revokedAt ||
      info.expiresAt.toMillis() <= Date.now() ||
      info.uses >= info.maxUses
    )
      throw new ApiError(
        410,
        "invalid_invite",
        "This invitation has expired, was revoked, or has reached its use limit.",
      );
    const space = db.doc(`workspaces/${identifier(info.workspaceId)}`);
    const [snapshot, existing, memberships, profile] = await Promise.all([
      tx.get(space),
      tx.get(space.collection("members").doc(user.uid)),
      tx.get(db.collection(`users/${user.uid}/workspaces`)),
      tx.get(db.doc(`users/${user.uid}`)),
    ]);
    if (!snapshot.exists)
      throw new ApiError(
        410,
        "invalid_invite",
        "This workspace no longer exists.",
      );
    if (!existing.exists) {
      if (memberships.size >= 100)
        throw new ApiError(
          409,
          "workspace_limit",
          "You can belong to at most 100 workspaces.",
        );
      tx.create(space.collection("members").doc(user.uid), {
        role: "member",
        displayName: displayName(user),
        joinedAt: now(),
      });
      tx.set(db.doc(`users/${user.uid}/workspaces/${space.id}`), {
        joinedAt: now(),
      });
      tx.update(ref, { uses: info.uses + 1 });
      tx.set(
        db.doc(`users/${user.uid}`),
        {
          displayName: displayName(user),
          photoURL: user.picture ?? null,
          createdAt: profile.data()?.createdAt ?? now(),
          updatedAt: now(),
        },
        { merge: true },
      );
    }
    const value = snapshot.data()!;
    return { id: space.id, name: value.name, ownerId: value.ownerId };
  });
  return json({ workspace });
}

async function mutateTask(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string | undefined,
  input: unknown,
) {
  const value = taskInput(input, !!id);
  const ref = id
    ? workspace.collection("tasks").doc(id)
    : workspace.collection("tasks").doc();
  const task = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const prior = id ? await tx.get(ref) : null;
    if (id && !prior?.exists)
      throw new ApiError(404, "not_found", "Task not found.");
    if (prior?.data()?.deleting)
      throw new ApiError(409, "deleting", "This task is being deleted.");
    if (value.assigneeId) {
      const assignee = await tx.get(
        workspace.collection("members").doc(String(value.assigneeId)),
      );
      if (!assignee.exists)
        throw new ApiError(
          400,
          "invalid_input",
          "The assignee is no longer a member.",
        );
    }
    if (id) tx.update(ref, { ...value, updatedAt: now() });
    else
      tx.create(ref, {
        ...value,
        createdBy: user.uid,
        createdAt: now(),
        updatedAt: now(),
      });
    const previous = prior?.data() ?? {};
    return {
      id: ref.id,
      title: value.title ?? previous.title,
      description: value.description ?? previous.description,
      status: value.status ?? previous.status,
      assigneeId:
        "assigneeId" in value ? value.assigneeId : previous.assigneeId,
      dueDate: "dueDate" in value ? value.dueDate : previous.dueDate,
      position: value.position ?? previous.position,
    };
  });
  return json({ task }, id ? 200 : 201);
}

async function mutateNote(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string | undefined,
  input: unknown,
  metadataOnly = false,
) {
  const data = object(
    input,
    id
      ? metadataOnly
        ? ["title", "expectedRevision", "parentId"]
        : ["title", "content", "expectedRevision", "parentId"]
      : ["title", "content", "parentId"],
  );
  const requestedParent = Object.hasOwn(data, "parentId")
    ? data.parentId === null
      ? null
      : identifier(data.parentId)
    : undefined;
  const title = text(data.title, "Note title", 200);
  const content = metadataOnly ? undefined : noteContent(data.content);
  const expected = id
    ? integer(data.expectedRevision, "Expected revision", 1, 1000000000)
    : 0;
  const ref = id
    ? workspace.collection("notes").doc(id)
    : workspace.collection("notes").doc();
  const saved = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const previous = id ? await tx.get(ref) : null;
    if (id && !previous?.exists)
      throw new ApiError(404, "not_found", "Note not found.");
    if (previous?.data()?.deleting)
      throw new ApiError(409, "deleting", "This note is being deleted.");
    if (previous?.data()?.collab && !metadataOnly)
      throw new ApiError(
        409,
        "collaboration_required",
        "This note uses real-time collaboration. Reload with the current editor.",
      );
    if (
      id &&
      (metadataOnly
        ? (previous?.data()?.metadataRevision ?? previous?.data()?.revision)
        : previous?.data()?.revision) !== expected
    )
      throw new ApiError(
        409,
        "revision_conflict",
        "Someone saved a newer version. Your draft has been kept; copy it or reload the saved note.",
      );
    const previousParent = previous?.data()?.parentId ?? null;
    const parentId =
      requestedParent === undefined ? previousParent : requestedParent;
    // Read the complete chain in the same transaction as the structural lock.
    // This also validates legacy data without imposing a product depth limit.
    const visited = new Set([ref.id]);
    let ancestorId = parentId;
    while (ancestorId !== null) {
      if (visited.has(ancestorId))
        throw new ApiError(
          409,
          "note_cycle",
          "A note cannot be moved inside itself or one of its descendants.",
        );
      visited.add(ancestorId);
      const ancestor = await tx.get(
        workspace.collection("notes").doc(identifier(ancestorId)),
      );
      if (!ancestor.exists || ancestor.data()?.deleting)
        throw new ApiError(
          400,
          "invalid_parent",
          "The parent note must exist in this workspace and must not be deleting.",
        );
      ancestorId = ancestor.data()?.parentId ?? null;
    }
    const next = (previous?.data()?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(next) || next > 1000000000)
      throw new ApiError(
        409,
        "state_limit",
        "This page has reached its version limit.",
      );
    const value = {
      title,
      ...(content ? { content } : {}),
      revision: next,
      ...(metadataOnly ? { metadataRevision: expected + 1 } : {}),
      parentId,
      updatedBy: user.uid,
      updatedAt: now(),
    };
    const history = await captureCheckpoint(
      tx,
      ref,
      { ...previous?.data(), ...value },
      user,
    );
    // All structural mutations touch this document. Transaction retries therefore
    // revalidate ancestry against concurrent creates, moves and deletions.
    if (!id || parentId !== previousParent)
      tx.update(workspace, { noteTreeRevision: FieldValue.increment(1) });
    if (id) tx.update(ref, { ...value, ...history });
    else
      tx.create(ref, {
        ...value,
        ...history,
        createdBy: user.uid,
        createdAt: now(),
      });
    return {
      revision: next,
      parentId,
      content: content ?? previous?.data()?.content,
      ...(metadataOnly ? { metadataRevision: expected + 1 } : {}),
      ...(previous?.data()?.collab ? { collab: previous.data()!.collab } : {}),
    };
  });
  return json({ note: { id: ref.id, title, ...saved } }, id ? 200 : 201);
}

function assertCheckpointSize(content: unknown, collab: unknown) {
  if (Buffer.byteLength(JSON.stringify({ content, collab }), "utf8") > 800000)
    throw new ApiError(
      413,
      "state_limit",
      "This document has reached its collaboration storage limit. Export a recovery copy.",
    );
}

function noteView(id: string, value: Record<string, unknown>) {
  return {
    id,
    title: value.title,
    content: value.content,
    revision: value.revision,
    ...(value.metadataRevision !== undefined
      ? { metadataRevision: value.metadataRevision }
      : {}),
    parentId: value.parentId ?? null,
    ...(value.collab ? { collab: value.collab } : {}),
  };
}

const HISTORY_INTERVAL = 5 * 60 * 1000;
const HISTORY_RETENTION = 30 * 24 * 60 * 60 * 1000;
function historyRecord(
  value: Record<string, unknown>,
  user: DecodedIdToken,
  kind = "checkpoint",
  name: string | null = null,
) {
  return {
    sourceRevision: value.revision,
    title: value.title,
    content: noteContent(value.content),
    kind,
    name,
    capturedAt: now(),
    capturedBy: user.uid,
    capturedName:
      typeof user.name === "string" ? user.name.slice(0, 200) : user.uid,
    expiresAt:
      kind === "named"
        ? null
        : Timestamp.fromMillis(Date.now() + HISTORY_RETENTION),
  };
}
async function captureCheckpoint(
  tx: Transaction,
  ref: DocumentReference,
  value: Record<string, unknown>,
  user: DecodedIdToken,
) {
  const at = value.historyCheckpointAt as Timestamp | undefined;
  if (at && Date.now() - at.toMillis() < HISTORY_INTERVAL) return {};
  const version = ref.collection("historyVersions").doc(`r${value.revision}`);
  const existing = await tx.get(version);
  if (!existing.exists) tx.create(version, historyRecord(value, user));
  return { historyCheckpointAt: now() };
}
function historyView(id: string, value: Record<string, unknown>, full = false) {
  return {
    id,
    sourceRevision: value.sourceRevision,
    title: value.title,
    kind: value.kind,
    name: value.name,
    capturedAt: (value.capturedAt as Timestamp).toMillis(),
    capturedBy: value.capturedBy,
    capturedName: value.capturedName,
    expiresAt: value.expiresAt
      ? (value.expiresAt as Timestamp).toMillis()
      : null,
    ...(full ? { content: value.content } : {}),
  };
}
function historyExpired(value: Record<string, unknown>) {
  return (
    value.expiresAt instanceof Timestamp &&
    value.expiresAt.toMillis() <= Date.now()
  );
}
function versionIdentifier(value: unknown) {
  const id = identifier(value);
  if (!/^r[1-9][0-9]{0,9}$/.test(id))
    throw new ApiError(400, "invalid_input", "Invalid history version.");
  return id;
}
async function pageHistory(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string,
  request: Request,
  input?: unknown,
) {
  const ref = workspace.collection("notes").doc(id);
  const params = new URL(request.url).searchParams;
  if (request.method === "POST") {
    await rateLimit(db, user.uid, "history_name", 10);
    const data = object(input, ["expectedRevision", "name"]);
    const revision = integer(
      data.expectedRevision,
      "Expected revision",
      1,
      1000000000,
    );
    const name = text(data.name, "Version name", 100);
    const result = await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      const [note, version] = await Promise.all([
        tx.get(ref),
        tx.get(ref.collection("historyVersions").doc(`r${revision}`)),
      ]);
      if (!note.exists) throw new ApiError(404, "not_found", "Note not found.");
      if (note.data()!.deleting)
        throw new ApiError(409, "deleting", "This note is being deleted.");
      if (version.exists && version.data()!.kind === "named") {
        if (version.data()!.name !== name)
          throw new ApiError(
            409,
            "version_named",
            "This version already has a different name.",
          );
        return version.ref;
      }
      if (note.data()!.revision !== revision)
        throw new ApiError(
          409,
          "revision_conflict",
          "Save and reload the latest page before naming a version.",
        );
      if (version.exists)
        tx.update(version.ref, { kind: "named", name, expiresAt: null });
      else
        tx.create(
          version.ref,
          historyRecord(note.data()!, user, "named", name),
        );
      return version.ref;
    });
    // Return immutable identity rather than a second, unauthorised content read.
    return json({ versionId: result.id });
  }
  const versionId = params.get("version");
  const beforeValue = params.get("before");
  const before =
    beforeValue === null
      ? undefined
      : integer(Number(beforeValue), "History cursor", 1, 1000000000);
  return json(
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      const note = await tx.get(ref);
      if (!note.exists) throw new ApiError(404, "not_found", "Note not found.");
      if (note.data()!.deleting)
        throw new ApiError(409, "deleting", "This note is being deleted.");
      if (versionId) {
        const version = await tx.get(
          ref.collection("historyVersions").doc(versionIdentifier(versionId)),
        );
        if (!version.exists || historyExpired(version.data()!))
          throw new ApiError(
            404,
            "not_found",
            "History version no longer available.",
          );
        return { version: historyView(version.id, version.data()!, true) };
      }
      let query = ref
        .collection("historyVersions")
        .orderBy("sourceRevision", "desc")
        .limit(21)
        .select(
          "sourceRevision",
          "title",
          "kind",
          "name",
          "capturedAt",
          "capturedBy",
          "capturedName",
          "expiresAt",
        );
      if (before !== undefined)
        query = query.where("sourceRevision", "<", before);
      const result = await tx.get(query);
      const page = result.docs.slice(0, 20);
      return {
        versions: page
          .filter((v) => !historyExpired(v.data()))
          .map((v) => historyView(v.id, v.data())),
        nextBefore:
          result.size > 20 ? page[page.length - 1].data().sourceRevision : null,
      };
    }),
  );
}
async function restoreHistory(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string,
  input: unknown,
) {
  await rateLimit(db, user.uid, "history_restore", 10);
  const data = object(input, ["versionId", "expectedRevision", "operationId"]);
  const versionId = versionIdentifier(data.versionId);
  const expected = integer(
    data.expectedRevision,
    "Expected revision",
    1,
    999999999,
  );
  const operationId = uuid(data.operationId);
  const digest = hash(JSON.stringify([versionId, expected]));
  const ref = workspace.collection("notes").doc(id);
  const receipt = ref
    .collection("historyRestores")
    .doc(hash(`${user.uid}:${operationId}`));
  const saved = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const [note, prior] = await Promise.all([tx.get(ref), tx.get(receipt)]);
    if (!note.exists) throw new ApiError(404, "not_found", "Note not found.");
    const value = note.data()!;
    if (value.deleting)
      throw new ApiError(409, "deleting", "This note is being deleted.");
    if (prior.exists) {
      if (prior.data()!.digest !== digest)
        throw new ApiError(
          409,
          "operation_conflict",
          "An operation ID cannot be reused.",
        );
      return noteView(id, value);
    }
    if (value.revision !== expected)
      throw new ApiError(
        409,
        "revision_conflict",
        "The page changed. Review its latest version before restoring.",
      );
    const [version, backup] = await Promise.all([
      tx.get(ref.collection("historyVersions").doc(versionId)),
      tx.get(ref.collection("historyVersions").doc(`r${value.revision}`)),
    ]);
    if (!version.exists || historyExpired(version.data()!))
      throw new ApiError(
        404,
        "not_found",
        "History version no longer available.",
      );
    const doc = initializeDocument(noteContent(version.data()!.content));
    try {
      validateDocument(doc);
      const collab = {
        version: 1,
        generation: randomUUID(),
        state: encodeDocument(doc),
        sequence: 0,
      };
      const next = {
        ...value,
        title: text(version.data()!.title, "Note title", 200),
        content: readContent(doc),
        collab,
        revision: value.revision + 1,
        metadataRevision: (value.metadataRevision ?? value.revision) + 1,
      };
      assertCheckpointSize(next.content, collab);
      if (!backup.exists)
        tx.create(backup.ref, historyRecord(value, user, "before_restore"));
      else if (backup.data()!.kind !== "named")
        // Renew recovery retention without replacing the immutable snapshot.
        tx.update(backup.ref, {
          kind: "before_restore",
          expiresAt: Timestamp.fromMillis(Date.now() + HISTORY_RETENTION),
        });
      tx.update(ref, {
        title: next.title,
        content: next.content,
        collab,
        revision: next.revision,
        metadataRevision: next.metadataRevision,
        historyCheckpointAt: now(),
        updatedBy: user.uid,
        updatedAt: now(),
      });
      tx.create(receipt, {
        uid: user.uid,
        operationId,
        digest,
        restoredRevision: next.revision,
        committedAt: now(),
      });
      return noteView(id, next);
    } finally {
      doc.destroy();
    }
  });
  return json({ note: saved, operationId });
}

async function collaborationOperation(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string,
  action: string,
  input: unknown,
) {
  const data = object(
    input,
    action === "collaboration" ? [] : ["operationId", "generation", "update"],
  );
  const operationId = action === "updates" ? uuid(data.operationId) : undefined;
  const generation = action === "updates" ? uuid(data.generation) : undefined;
  let update: Uint8Array | undefined;
  if (action === "updates") {
    try {
      if (
        typeof data.update !== "string" ||
        data.update.length > Math.ceil(MAX_UPDATE_BYTES / 3) * 4
      )
        throw new Error("Invalid update length");
      update = fromBase64(data.update);
      if (!update.byteLength || update.byteLength > MAX_UPDATE_BYTES)
        throw new Error("Invalid update length");
    } catch {
      throw new ApiError(
        400,
        "invalid_update",
        "The collaboration update is invalid or too large.",
      );
    }
  }
  const ref = workspace.collection("notes").doc(id);
  const receipt = operationId
    ? ref
        .collection("collaborationReceipts")
        .doc(hash(`${user.uid}:${operationId}`))
    : null;
  const digest = update
    ? createHash("sha256").update(generation!).update(update).digest("hex")
    : undefined;
  const saved = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists)
      throw new ApiError(404, "not_found", "Note not found.");
    const value = snapshot.data()!;
    if (value.deleting)
      throw new ApiError(409, "deleting", "This note is being deleted.");
    if (action === "collaboration") {
      if (value.collab) return noteView(id, value);
      const doc = initializeDocument(noteContent(value.content));
      try {
        validateDocument(doc);
        const collab = {
          version: 1,
          generation: randomUUID(),
          state: encodeDocument(doc),
          sequence: 0,
        };
        const next = {
          ...value,
          content: readContent(doc),
          collab,
          revision: value.revision + 1,
          metadataRevision: value.revision,
        };
        assertCheckpointSize(next.content, collab);
        tx.update(ref, {
          content: next.content,
          collab,
          revision: next.revision,
          metadataRevision: next.metadataRevision,
          updatedBy: user.uid,
          updatedAt: now(),
        });
        return noteView(id, next);
      } finally {
        doc.destroy();
      }
    }
    if (!value.collab)
      throw new ApiError(
        409,
        "collaboration_required",
        "Initialize collaboration before editing.",
      );
    if (value.collab.generation !== generation)
      throw new ApiError(
        409,
        "generation_conflict",
        "The document generation changed. Keep a recovery copy and reload.",
      );
    const priorReceipt = await tx.get(receipt!);
    if (priorReceipt.exists) {
      if (priorReceipt.data()?.digest !== digest)
        throw new ApiError(
          409,
          "operation_conflict",
          "An operation ID cannot be reused with different content.",
        );
      return noteView(id, value);
    }
    if (
      !Number.isSafeInteger(value.collab.sequence) ||
      value.collab.sequence >= 1000000000 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision >= 1000000000
    )
      throw new ApiError(
        409,
        "state_limit",
        "This document has reached its collaboration version limit. Export a recovery copy.",
      );
    const previous = decodeDocument(value.collab.state);
    const doc = decodeDocument(value.collab.state);
    try {
      try {
        Y.applyUpdate(doc, update!);
        if (doc.store.pendingStructs || doc.store.pendingDs)
          throw new ApiError(
            409,
            "missing_dependencies",
            "Earlier updates must be synchronized before this update. Retry in order.",
          );
        validateDocument(doc, previous);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          400,
          "invalid_update",
          "The collaboration update violates the document schema or limits.",
        );
      }
      let state: string;
      try {
        state = encodeDocument(doc);
      } catch {
        throw new ApiError(
          413,
          "state_limit",
          "This document has reached its collaboration storage limit. Export a recovery copy.",
        );
      }
      const collab = {
        ...value.collab,
        state,
        sequence: value.collab.sequence + 1,
      };
      const content = noteContent(readContent(doc));
      assertCheckpointSize(content, collab);
      const history = await captureCheckpoint(
        tx,
        ref,
        { ...value, content, revision: value.revision + 1 },
        user,
      );
      tx.update(ref, {
        ...history,
        collab,
        content,
        revision: value.revision + 1,
        updatedBy: user.uid,
        updatedAt: now(),
      });
      tx.create(receipt!, {
        uid: user.uid,
        operationId,
        generation,
        digest,
        sequence: collab.sequence,
        committedAt: now(),
      });
      return noteView(id, {
        ...value,
        collab,
        content,
        revision: value.revision + 1,
      });
    } finally {
      previous.destroy();
      doc.destroy();
    }
  });
  return json({ note: saved, ...(operationId ? { operationId } : {}) });
}

async function presenceOperation(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  id: string,
  method: string,
  input: unknown,
) {
  const data = object(input, ["sessionId"]);
  const sessionId = uuid(data.sessionId);
  await rateLimit(db, user.uid, "presence", 10);
  const note = workspace.collection("notes").doc(id);
  const ref = note.collection("presence").doc(hash(`${user.uid}:${sessionId}`));
  await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const [snapshot, membership] = await Promise.all([
      tx.get(note),
      tx.get(workspace.collection("members").doc(user.uid)),
    ]);
    if (!snapshot.exists || snapshot.data()?.deleting)
      throw new ApiError(404, "not_found", "Note not found.");
    if (method === "DELETE") tx.delete(ref);
    else
      tx.set(ref, {
        uid: user.uid,
        sessionId,
        displayName: membership.data()?.displayName ?? "Teammate",
        lastSeen: now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 90000),
      });
  });
  return json({ ok: true });
}

function commentView(id: string, value: Record<string, unknown>) {
  return {
    id,
    body: value.body,
    authorId: value.authorId,
    authorName: value.authorName,
    createdAt: (value.createdAt as Timestamp).toMillis(),
    deleted: value.deleted,
    mentions: value.mentions,
  };
}
async function conversationOperation(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  resource: "notes" | "tasks",
  id: string,
  commentId: string | undefined,
  input?: unknown,
) {
  await rateLimit(
    db,
    user.uid,
    commentId ? "comment_delete" : "comment_post",
    commentId ? 30 : 20,
  );
  const parent = workspace.collection(resource).doc(id);
  const data = commentId ? undefined : object(input, ["operationId", "body"]);
  const operationId = data ? uuid(data.operationId) : undefined;
  const message = data ? text(data.body, "Comment", 4000) : undefined;
  const digest = data ? hash(data.body as string) : undefined;
  const ref = parent
    .collection("comments")
    .doc(commentId ?? hash(`${user.uid}:${operationId}`));
  const comment = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const [entity, previous] = await Promise.all([tx.get(parent), tx.get(ref)]);
    if (!entity.exists)
      throw new ApiError(404, "not_found", "This item no longer exists.");
    if (entity.data()!.deleting)
      throw new ApiError(409, "deleting", "This item is being deleted.");
    if (commentId) {
      if (!previous.exists)
        throw new ApiError(404, "not_found", "Comment not found.");
      const value = previous.data()!;
      if (value.authorId !== user.uid)
        throw new ApiError(
          403,
          "forbidden",
          "Only the author can delete this comment.",
        );
      if (!value.deleted)
        tx.update(ref, { body: "", mentions: [], deleted: true });
      return commentView(ref.id, {
        ...value,
        body: "",
        mentions: [],
        deleted: true,
      });
    }
    if (previous.exists) {
      if (
        previous.data()!.digest !== digest ||
        previous.data()!.authorId !== user.uid
      )
        throw new ApiError(
          409,
          "operation_conflict",
          "An operation ID cannot be reused with a different comment.",
        );
      return commentView(ref.id, previous.data()!);
    }
    const mentionIds = [
      ...new Set(
        [...message!.matchAll(/@\{([^{}]+)\}/g)].map((match) =>
          identifier(match[1]),
        ),
      ),
    ];
    if (mentionIds.length > 10)
      throw new ApiError(
        400,
        "invalid_input",
        "A comment can mention at most ten people.",
      );
    const memberships = await Promise.all(
      mentionIds.map((uid) => tx.get(workspace.collection("members").doc(uid))),
    );
    if (memberships.some((snapshot) => !snapshot.exists))
      throw new ApiError(
        400,
        "invalid_mention",
        "Mentioned people must be current members of this workspace.",
      );
    const value = {
      body: message,
      authorId: user.uid,
      authorName:
        typeof user.name === "string" ? user.name.slice(0, 200) : user.uid,
      createdAt: Timestamp.now(),
      deleted: false,
      mentions: memberships.map((snapshot, index) => ({
        uid: mentionIds[index],
        displayName:
          typeof snapshot.data()!.displayName === "string"
            ? snapshot.data()!.displayName.slice(0, 200)
            : mentionIds[index],
      })),
      operationId,
      digest,
    };
    tx.create(ref, value);
    return commentView(ref.id, value);
  });
  return json({ comment });
}

async function inviteOperation(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  method: string,
  id: string | undefined,
  input?: unknown,
) {
  if (method === "DELETE" && !id) {
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid, true);
      const invites = await tx.get(
        db
          .collection("invites")
          .where("workspaceId", "==", workspace.id)
          .where("revokedAt", "==", null)
          .limit(450),
      );
      if (invites.size >= 450)
        throw new ApiError(
          409,
          "invite_limit",
          "Revoke invitations individually before revoking all.",
        );
      invites.docs.forEach((invite) =>
        tx.update(invite.ref, { revokedAt: now() }),
      );
    });
    return json({ ok: true });
  }
  if (method === "GET" && !id) {
    await db.runTransaction((tx) => member(tx, workspace, user.uid, true));
    const result = await db
      .collection("invites")
      .where("workspaceId", "==", workspace.id)
      .limit(100)
      .get();
    return json({
      invites: result.docs.map((doc) => {
        const value = doc.data();
        return {
          id: doc.id,
          expiresAt: value.expiresAt.toDate().toISOString(),
          revoked: !!value.revokedAt,
          maxUses: value.maxUses,
          uses: value.uses,
        };
      }),
    });
  }
  if (method === "DELETE" && id) {
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid, true);
      const ref = db.doc(`invites/${id}`);
      const invite = await tx.get(ref);
      if (!invite.exists || invite.data()?.workspaceId !== workspace.id)
        throw new ApiError(404, "not_found", "Invitation not found.");
      tx.update(ref, { revokedAt: now() });
    });
    return json({ ok: true });
  }
  if (method !== "POST" || id)
    throw new ApiError(404, "not_found", "Endpoint not found.");
  await rateLimit(db, user.uid, "invite_create", 10);
  const data = object(input, ["maxUses", "expiresInHours"]);
  const maxUses = integer(data.maxUses ?? 25, "Maximum uses", 1, 100);
  const hours = integer(data.expiresInHours ?? 168, "Expiry hours", 1, 168);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const expiresAt = Timestamp.fromMillis(Date.now() + hours * 3600000);
  await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid, true);
    tx.create(db.doc(`invites/${tokenHash}`), {
      workspaceId: workspace.id,
      createdBy: user.uid,
      createdAt: now(),
      expiresAt,
      revokedAt: null,
      maxUses,
      uses: 0,
    });
  });
  return json(
    { token, hash: tokenHash, expiresAt: expiresAt.toDate().toISOString() },
    201,
  );
}

async function removeMember(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  uid: string,
) {
  await db.runTransaction(async (tx) => {
    const space = await member(tx, workspace, user.uid, user.uid !== uid);
    const target = await tx.get(workspace.collection("members").doc(uid));
    if (!target.exists)
      throw new ApiError(404, "not_found", "Member not found.");
    if (space.data()?.ownerId === uid)
      throw new ApiError(
        409,
        "owner_required",
        "Transfer ownership before leaving.",
      );
    const tasks = await tx.get(
      workspace.collection("tasks").where("assigneeId", "==", uid).limit(450),
    );
    if (tasks.size >= 450)
      throw new ApiError(
        409,
        "too_many_assignments",
        "Unassign some tasks before removing this member.",
      );
    tasks.docs.forEach((task) =>
      tx.update(task.ref, { assigneeId: null, updatedAt: now() }),
    );
    tx.delete(target.ref);
    tx.delete(db.doc(`users/${uid}/workspaces/${workspace.id}`));
  });
  return json({ ok: true });
}

async function transferOwner(
  db: Firestore,
  workspace: DocumentReference,
  user: DecodedIdToken,
  input: unknown,
) {
  const data = object(input, ["uid"]);
  const uid = identifier(data.uid);
  await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid, true);
    const target = await tx.get(workspace.collection("members").doc(uid));
    if (!target.exists)
      throw new ApiError(
        400,
        "invalid_input",
        "The new owner must already be a member.",
      );
    if (uid === user.uid) return;
    tx.update(workspace, { ownerId: uid });
    tx.update(workspace.collection("members").doc(user.uid), {
      role: "member",
    });
    tx.update(target.ref, { role: "owner" });
  });
  return json({ ok: true });
}

function bucket(storage: Storage) {
  if (!process.env.FIREBASE_STORAGE_BUCKET)
    throw new ApiError(
      503,
      "storage_not_configured",
      "Attachments are not configured. Ask the administrator to finish Storage setup.",
    );
  return storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
}

function attachmentView(id: string, value: Record<string, unknown>) {
  return {
    id,
    parentType: value.parentType,
    parentId: value.parentId,
    originalName: value.originalName,
    contentType: value.contentType,
    bytes: value.bytes,
    uploadedBy: value.uploadedBy,
    hasThumbnail: !!value.thumbnailPath,
    status: "ready",
  };
}

function validMagic(bytes: Buffer, contentType: string) {
  if (contentType === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  return (
    contentType === "application/pdf" &&
    bytes.toString("ascii", 0, 5) === "%PDF-"
  );
}

async function attachmentOperation(
  db: Firestore,
  storage: Storage,
  workspace: DocumentReference,
  user: DecodedIdToken,
  request: Request,
  id: string | undefined,
  action: string | undefined,
) {
  await rateLimit(db, user.uid, "attachments", 30);
  const files = bucket(storage);
  if (request.method === "POST" && !id && !action) {
    const data = object(await body(request), [
      "parentType",
      "parentId",
      "originalName",
      "contentType",
      "bytes",
    ]);
    if (data.parentType !== "task" && data.parentType !== "note")
      throw new ApiError(400, "invalid_input", "Invalid attachment parent.");
    const parentType = data.parentType;
    const parentId = identifier(data.parentId);
    const originalName = text(data.originalName, "Filename", 200).replace(
      /[\r\n]/g,
      "",
    );
    const contentType = text(data.contentType, "Content type", 100);
    const bytes = integer(data.bytes, "File size", 1, MAX_BYTES);
    const extension: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
    };
    if (!Object.hasOwn(extension, contentType))
      throw new ApiError(
        400,
        "invalid_input",
        "Only JPEG, PNG, WebP, and PDF files are supported.",
      );
    const ref = workspace.collection("attachments").doc();
    const stagingPath = `staging/${workspace.id}/${ref.id}`;
    const storagePath = `workspaces/${workspace.id}/${parentType}/${parentId}/${ref.id}/file.${extension[contentType]}`;
    const thumbnailPath =
      contentType === "application/pdf"
        ? null
        : `${storagePath}.thumbnail.${contentType === "image/png" ? "png" : "webp"}`;
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      const [parent, attachments] = await Promise.all([
        tx.get(workspace.collection(`${parentType}s`).doc(parentId)),
        tx.get(
          workspace
            .collection("attachments")
            .where("parentId", "==", parentId)
            .where("parentType", "==", parentType),
        ),
      ]);
      if (!parent.exists || parent.data()?.deleting)
        throw new ApiError(
          404,
          "not_found",
          "The attachment parent no longer exists.",
        );
      if (attachments.size >= 50)
        throw new ApiError(
          409,
          "attachment_limit",
          "A task or note can have at most 50 attachments.",
        );
      tx.create(ref, {
        parentType,
        parentId,
        originalName,
        contentType,
        bytes,
        storagePath,
        stagingPath,
        thumbnailPath,
        status: "pending",
        uploadedBy: user.uid,
        createdAt: now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600000),
      });
    });
    try {
      const uploadHeaders = {
        "Content-Type": contentType,
        "x-goog-content-length-range": `${bytes},${bytes}`,
        "x-goog-if-generation-match": "0",
      };
      const [uploadUrl] = await files.file(stagingPath).getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        extensionHeaders: {
          "x-goog-content-length-range":
            uploadHeaders["x-goog-content-length-range"],
          "x-goog-if-generation-match": "0",
        },
        expires: Date.now() + 15 * 60000,
      });
      return json({ attachmentId: ref.id, uploadUrl, uploadHeaders }, 201);
    } catch (error) {
      await ref.delete();
      throw error;
    }
  }
  if (!id) throw new ApiError(404, "not_found", "Endpoint not found.");
  const ref = workspace.collection("attachments").doc(id);
  const value = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists)
      throw new ApiError(404, "not_found", "Attachment not found.");
    return snapshot.data()!;
  });
  if (
    request.method === "GET" &&
    (action === "download" || action === "thumbnail")
  ) {
    if (value.status !== "ready")
      throw new ApiError(409, "not_ready", "This attachment is not available.");
    if (action === "thumbnail" && !value.thumbnailPath)
      throw new ApiError(404, "not_found", "This file has no thumbnail.");
    const [url] = await files
      .file(action === "thumbnail" ? value.thumbnailPath : value.storagePath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 60000,
        responseDisposition:
          action === "thumbnail"
            ? "inline"
            : `attachment; filename*=UTF-8''${encodeURIComponent(value.originalName)}`,
      });
    return json({ url });
  }
  if (request.method === "DELETE" && !action) {
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      const snapshot = await tx.get(ref);
      if (snapshot.exists) tx.update(ref, { status: "deleting" });
    });
    await Promise.all([
      files.file(value.storagePath).delete({ ignoreNotFound: true }),
      files.file(value.stagingPath).delete({ ignoreNotFound: true }),
      ...(value.thumbnailPath
        ? [files.file(value.thumbnailPath).delete({ ignoreNotFound: true })]
        : []),
    ]);
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      tx.delete(ref);
    });
    return json({ ok: true });
  }
  if (request.method !== "POST" || action !== "complete")
    throw new ApiError(404, "not_found", "Endpoint not found.");
  if (value.uploadedBy !== user.uid)
    throw new ApiError(
      403,
      "forbidden",
      "Only the uploader can finish this upload.",
    );
  if (value.status === "ready")
    return json({ attachment: attachmentView(id, value) });
  if (value.status !== "pending")
    throw new ApiError(409, "not_ready", "This upload is being deleted.");
  const staged = files.file(value.stagingPath);
  const [metadata] = await staged.getMetadata();
  const size = Number(metadata.size);
  if (
    size !== value.bytes ||
    size > MAX_BYTES ||
    metadata.contentType !== value.contentType
  ) {
    await staged.delete({ ignoreNotFound: true });
    throw new ApiError(
      400,
      "invalid_file",
      "The uploaded file's size or format does not match. Delete it and try again.",
    );
  }
  // Pin the generation so a signed PUT cannot replace bytes between validation and promotion.
  const generation = Number(metadata.generation);
  const source = files.file(value.stagingPath, { generation });
  const [bytes] = await source.download();
  if (!validMagic(bytes, value.contentType)) {
    await staged.delete({ ignoreNotFound: true });
    throw new ApiError(
      400,
      "invalid_file",
      "The uploaded file does not match its declared format.",
    );
  }
  let thumbnail: Buffer | null = null;
  const thumbnailType =
    value.contentType === "image/png" ? "image/png" : "image/webp";
  const thumbnailPath =
    value.contentType === "application/pdf"
      ? null
      : `${value.storagePath}.thumbnail.${thumbnailType === "image/png" ? "png" : "webp"}`;
  if (thumbnailPath) {
    try {
      const image = sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: "error",
        animated: false,
      })
        .rotate()
        .resize({
          width: 400,
          height: 400,
          fit: "inside",
          withoutEnlargement: true,
        });
      thumbnail = await (
        thumbnailType === "image/png"
          ? image.png()
          : image.webp({ quality: 82 })
      ).toBuffer();
    } catch {
      await source.delete({ ignoreNotFound: true });
      throw new ApiError(
        400,
        "invalid_file",
        "The image is corrupt or exceeds the 40-megapixel decoding limit.",
      );
    }
  }
  if (thumbnail && thumbnailPath) {
    try {
      await files.file(thumbnailPath).save(thumbnail, {
        resumable: false,
        contentType: thumbnailType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { cacheControl: "private, no-store" },
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
    }
  }
  // A create-only destination also makes concurrent completion safe.
  try {
    await files.file(value.storagePath).save(bytes, {
      resumable: false,
      contentType: value.contentType,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { cacheControl: "private, no-store" },
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 412) {
      await Promise.all([
        files.file(value.storagePath).delete({ ignoreNotFound: true }),
        ...(thumbnailPath
          ? [files.file(thumbnailPath).delete({ ignoreNotFound: true })]
          : []),
      ]);
      throw error;
    }
  }
  try {
    await db.runTransaction(async (tx) => {
      await member(tx, workspace, user.uid);
      const [snapshot, parent] = await Promise.all([
        tx.get(ref),
        tx.get(
          workspace.collection(`${value.parentType}s`).doc(value.parentId),
        ),
      ]);
      if (
        !snapshot.exists ||
        !parent.exists ||
        parent.data()?.deleting ||
        !["pending", "ready"].includes(snapshot.data()?.status)
      )
        throw new ApiError(
          409,
          "parent_removed",
          "The attachment was removed during upload.",
        );
      tx.update(ref, {
        status: "ready",
        thumbnailPath,
        completedAt: now(),
        expiresAt: FieldValue.delete(),
      });
    });
  } catch (error) {
    await Promise.all([
      files.file(value.storagePath).delete({ ignoreNotFound: true }),
      ...(thumbnailPath
        ? [files.file(thumbnailPath).delete({ ignoreNotFound: true })]
        : []),
    ]);
    throw error;
  }
  await source.delete({ ignoreNotFound: true });
  return json({ attachment: attachmentView(id, { ...value, thumbnailPath }) });
}

async function deleteParent(
  db: Firestore,
  storage: Storage,
  workspace: DocumentReference,
  user: DecodedIdToken,
  resource: "tasks" | "notes",
  id: string,
) {
  const ref = workspace.collection(resource).doc(id);
  const attachments = await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    const [snapshot, items] = await Promise.all([
      tx.get(ref),
      tx.get(
        workspace
          .collection("attachments")
          .where("parentId", "==", id)
          .where("parentType", "==", resource === "tasks" ? "task" : "note"),
      ),
    ]);
    if (!snapshot.exists)
      throw new ApiError(404, "not_found", "This item no longer exists.");
    if (resource === "notes") {
      const children = await tx.get(
        workspace.collection("notes").where("parentId", "==", id).limit(1),
      );
      if (!children.empty)
        throw new ApiError(
          409,
          "note_has_children",
          "Move or delete this note's children before deleting it.",
        );
      tx.update(workspace, { noteTreeRevision: FieldValue.increment(1) });
    }
    tx.update(ref, { deleting: true });
    items.docs.forEach((item) => tx.update(item.ref, { status: "deleting" }));
    return items.docs;
  });
  if (attachments.length) {
    const files = bucket(storage);
    await Promise.all(
      attachments.map(async (attachment) => {
        const value = attachment.data();
        await Promise.all([
          files.file(value.storagePath).delete({ ignoreNotFound: true }),
          files.file(value.stagingPath).delete({ ignoreNotFound: true }),
          ...(value.thumbnailPath
            ? [files.file(value.thumbnailPath).delete({ ignoreNotFound: true })]
            : []),
        ]);
      }),
    );
  }
  if (resource === "notes") {
    // Firestore does not cascade subcollections. The live-note fence above
    // prevents new receipts/leases while cleanup runs; no receipt has a TTL.
    // Keep the fenced parent until cleanup succeeds so a failed delete can retry.
    await db.recursiveDelete(ref.collection("collaborationReceipts"));
    await db.recursiveDelete(ref.collection("presence"));
    await db.recursiveDelete(ref.collection("historyVersions"));
    await db.recursiveDelete(ref.collection("historyRestores"));
  }
  await db.recursiveDelete(ref.collection("comments"));
  await db.runTransaction(async (tx) => {
    await member(tx, workspace, user.uid);
    if (resource === "notes")
      tx.update(workspace, { noteTreeRevision: FieldValue.increment(1) });
    attachments.forEach((item) => tx.delete(item.ref));
    tx.delete(ref);
  });
  return json({ ok: true });
}

export type TrustedApiContext = {
  db: Firestore;
  storage: Storage;
  user: DecodedIdToken;
};

export async function handleApi(
  request: Request,
  path: string[],
): Promise<Response> {
  try {
    return await handleTrustedApi(request, path, await authenticate(request));
  } catch (error) {
    return apiFailure(error);
  }
}

// Trusted context is created only by the authentication boundary above. Keeping the
// dispatcher separate lets emulator tests exercise actual transactions and SDK calls.
export async function handleTrustedApi(
  request: Request,
  path: string[],
  context: TrustedApiContext,
): Promise<Response> {
  try {
    if (
      path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part) || part.length > 128)
    )
      throw new ApiError(400, "invalid_input", "Invalid path.");
    const { db, user, storage } = context;
    const method = request.method;
    if (path.length === 1 && path[0] === "workspaces") {
      if (method === "GET") return await workspaceList(db, user.uid);
      if (method === "POST")
        return await createWorkspace(db, user, await body(request));
    }
    if (path.join("/") === "invites/redeem" && method === "POST")
      return await redeemInvite(db, user, await body(request));
    if (path[0] !== "workspaces" || !path[1])
      throw new ApiError(404, "not_found", "Endpoint not found.");
    const workspace = db.doc(`workspaces/${identifier(path[1])}`);
    const [, , resource, itemId, action, commentId] = path;
    if (path.length > 6 || (path.length === 6 && action !== "comments"))
      throw new ApiError(404, "not_found", "Endpoint not found.");
    if (resource === "tasks" || resource === "notes") {
      if (itemId && action === "comments") {
        if (
          (method === "POST" && path.length === 5) ||
          (method === "DELETE" && path.length === 6)
        )
          return await conversationOperation(
            db,
            workspace,
            user,
            resource,
            itemId,
            commentId,
            method === "POST" ? await body(request) : undefined,
          );
        throw new ApiError(404, "not_found", "Endpoint not found.");
      }
      if (resource === "notes" && itemId && action) {
        if (action === "history" && ["GET", "POST"].includes(method))
          return await pageHistory(
            db,
            workspace,
            user,
            itemId,
            request,
            method === "POST" ? await body(request) : undefined,
          );
        if (action === "restore" && method === "POST")
          return await restoreHistory(
            db,
            workspace,
            user,
            itemId,
            await body(request),
          );
        if (method === "POST" && ["collaboration", "updates"].includes(action))
          return await collaborationOperation(
            db,
            workspace,
            user,
            itemId,
            action,
            await body(request),
          );
        if (method === "PATCH" && action === "metadata")
          return await mutateNote(
            db,
            workspace,
            user,
            itemId,
            await body(request),
            true,
          );
        if (["POST", "DELETE"].includes(method) && action === "presence")
          return await presenceOperation(
            db,
            workspace,
            user,
            itemId,
            method,
            await body(request),
          );
      }
      if (action) throw new ApiError(404, "not_found", "Endpoint not found.");
      if ((method === "POST" && !itemId) || (method === "PATCH" && itemId))
        return await (resource === "tasks"
          ? mutateTask(db, workspace, user, itemId, await body(request))
          : mutateNote(db, workspace, user, itemId, await body(request)));
      if (method === "DELETE" && itemId)
        return await deleteParent(
          db,
          storage,
          workspace,
          user,
          resource,
          itemId,
        );
    }
    if (resource === "invites" && !action)
      return await inviteOperation(
        db,
        workspace,
        user,
        method,
        itemId,
        method === "POST" ? await body(request) : undefined,
      );
    if (resource === "members" && itemId && !action && method === "DELETE")
      return await removeMember(db, workspace, user, itemId);
    if (resource === "owner" && !itemId && method === "PATCH")
      return await transferOwner(db, workspace, user, await body(request));
    if (resource === "attachments")
      return await attachmentOperation(
        db,
        storage,
        workspace,
        user,
        request,
        itemId,
        action,
      );
    throw new ApiError(404, "not_found", "Endpoint not found.");
  } catch (error) {
    return apiFailure(error);
  }
}

function apiFailure(error: unknown) {
  if (error instanceof ApiError)
    return json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  // Never expose credential, bucket, or database diagnostics to a browser.
  console.error(
    "Teamspace API operation failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return json(
    {
      error: {
        code: "server_error",
        message: "The operation could not be completed. Please try again.",
      },
    },
    500,
  );
}
