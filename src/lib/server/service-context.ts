import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentStore as Firestore, type Transaction, type DocumentReference } from "./document-store";
import { ApiError } from "./validation";

/** Populated by a trusted authentication boundary, never from mutation input. */
export type ServiceActor = { uid: string; name?: string; picture?: string; email?: string; email_verified?: boolean };
export const now = () => FieldValue.serverTimestamp();
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function rateLimit(
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

export async function member(
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

