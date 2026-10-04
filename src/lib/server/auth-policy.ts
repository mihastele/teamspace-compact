import type { DocumentStore, StoreData } from "./document-store";
import { ApiError } from "./validation";

export function assertAuthPolicy(policy: StoreData | undefined, required: boolean, verified: boolean) {
  if ((policy?.emailConfirmationRequired ?? true) !== required)
    throw new ApiError(503, "policy_mismatch", "Authentication policy must be published before this deployment accepts traffic.");
  if (required && !verified)
    throw new ApiError(403, "email_confirmation_required", "Confirm your email before opening the workspace.");
}

/** Policy tightening participates in the same read set as the durable mutation. */
export function guardedDocumentStore(db: DocumentStore, required: boolean, verified: boolean): DocumentStore {
  return {
    ...db,
    runTransaction: action => db.runTransaction(async tx => {
      const policy = await tx.get(db.doc("security/policy"));
      assertAuthPolicy(policy.data(), required, verified);
      return action(tx);
    }),
  };
}
