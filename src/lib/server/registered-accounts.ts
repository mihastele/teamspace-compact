import "server-only";
import { backendConfiguration } from "./backend-config";
import { firebaseAdmin } from "./firebase";
import { supabaseAdmin } from "./supabase";
import { ApiError } from "./validation";

export type RegisteredAccount = { uid: string; displayName: string; photoURL: string | null };
export type AccountResolver = (account: string) => Promise<RegisteredAccount | null>;

/** Called only after workspace-admin authorization and rate limiting. No public directory. */
export const resolveRegisteredAccount: AccountResolver = async (account) => {
  try {
    if (backendConfiguration().provider === "supabase") {
      const backend = supabaseAdmin();
      let uid = account;
      if (account.includes("@")) {
        const { data, error } = await backend.client.rpc("teamspace_registered_account_id", { p_email: account });
        if (error) throw new Error("Account lookup unavailable");
        if (!data) return null;
        uid = String(data);
      }
      const { data, error } = await backend.auth.admin.getUserById(uid);
      if (error) {
        if (error.status === 404 || error.code === "user_not_found") return null;
        throw error;
      }
      const user = data.user;
      if (!user || user.deleted_at || user.is_anonymous || (user.banned_until && new Date(user.banned_until).getTime() > Date.now())) return null;
      const name = user.user_metadata.display_name ?? user.user_metadata.full_name;
      return { uid: user.id, displayName: typeof name === "string" ? name.slice(0, 100) : "Teammate", photoURL: typeof user.user_metadata.avatar_url === "string" ? user.user_metadata.avatar_url : null };
    }
    const auth = firebaseAdmin().auth;
    const user = account.includes("@") ? await auth.getUserByEmail(account) : await auth.getUser(account);
    if (user.disabled) return null;
    return { uid: user.uid, displayName: user.displayName?.slice(0, 100) || "Teammate", photoURL: user.photoURL ?? null };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "auth/user-not-found") return null;
    throw new ApiError(503, "account_lookup_unavailable", "Account lookup is unavailable. Retry shortly.");
  }
};
