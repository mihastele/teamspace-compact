/** Configuration guard only; Auth verification stays with the provider SDK. */
export function isPrivilegedSupabaseKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return claims.role === "service_role";
  } catch {
    return false;
  }
}
