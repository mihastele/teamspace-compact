import { ApiError } from "./validation";

/** Privilege configuration is server-only and is never derived from account metadata. */
export function accessConfiguration() {
  const raw = process.env.ROOT_ADMIN_UIDS?.trim() || "";
  const roots = raw ? raw.split(",").map((uid) => uid.trim()) : [];
  const developmentWorkspace = process.env.DEV_AUTO_JOIN_WORKSPACE_ID?.trim() || null;
  if (roots.length > 100 || roots.some((uid) => !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)))
    throw new ApiError(503, "invalid_configuration", "ROOT_ADMIN_UIDS must contain comma-separated account IDs.");
  if (developmentWorkspace && (!/^[a-zA-Z0-9_-]{1,128}$/.test(developmentWorkspace) || process.env.NODE_ENV !== "development"))
    throw new ApiError(503, "invalid_configuration", "DEV_AUTO_JOIN_WORKSPACE_ID is allowed only in development with a valid workspace ID.");
  return { roots: new Set(roots), developmentWorkspace };
}

export function isRootAdmin(uid: string): boolean {
  return accessConfiguration().roots.has(uid);
}
