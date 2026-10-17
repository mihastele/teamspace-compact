import "server-only";
import { Timestamp, type DocumentStore as Firestore, type DocumentReference } from "./document-store";
import { member, rateLimit, hash, type ServiceActor } from "./service-context";
import { ApiError, identifier, object, text, uuid } from "./validation";

export function commentView(id: string, value: Record<string, unknown>) {
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

export async function getConversation(
  db: Firestore, workspace: DocumentReference, user: ServiceActor,
  resource: "notes" | "tasks", id: string,
) {
  const parent = workspace.collection(resource).doc(identifier(id));
  return db.runTransaction(async tx => {
    await member(tx, workspace, user.uid);
    const entity = await tx.get(parent);
    if (!entity.exists || entity.data()?.deleting)
      throw new ApiError(404, "not_found", "This item no longer exists.");
    const items = await tx.get(parent.collection("comments").orderBy("createdAt", "desc").limit(50));
    return items.docs.map(item => commentView(item.id, item.data())).reverse();
  });
}

export async function changeConversation(
  db: Firestore,
  workspace: DocumentReference,
  user: ServiceActor,
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
  return comment;
}

