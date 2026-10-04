import { ApiError } from "./validation";
import { isPrivilegedSupabaseKey } from "../public-key";
export function strictFlag(name: string, fallback: boolean) {
    const value = process.env[name];
    if (value === undefined || value === "")
        return fallback;
    if (value !== "true" && value !== "false")
        throw new ApiError(503, "invalid_configuration", `${name} must be true or false.`);
    return value === "true";
}
export function backendConfiguration() {
    if (isPrivilegedSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY))
        throw new ApiError(503,"invalid_configuration","The Supabase browser setting must use a public key, never a server key.");
    const provider = process.env.BACKEND_PROVIDER ?? "firebase";
    if (provider !== "firebase" && provider !== "supabase")
        throw new ApiError(503, "invalid_configuration", "Unsupported backend provider.");
    if ((process.env.NEXT_PUBLIC_BACKEND_PROVIDER ?? "firebase") !== provider)
        throw new ApiError(503, "invalid_configuration", "Server and browser backend selections must match. Rebuild the application.");
    const emailConfirmationRequired = strictFlag("EMAIL_CONFIRMATION_REQUIRED", true);
    const passwordAuthEnabled = strictFlag("PASSWORD_AUTH_ENABLED", true);
    const googleAuthEnabled = strictFlag("GOOGLE_AUTH_ENABLED", true);
    const configured = provider === "supabase"
        ? !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        : !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_STORAGE_BUCKET && process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID && process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    if (provider === "supabase" && process.env.SUPABASE_URL !== process.env.NEXT_PUBLIC_SUPABASE_URL)
        throw new ApiError(503, "invalid_configuration", "Server and browser Supabase projects must match.");
    if (provider === "firebase" && process.env.FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
        throw new ApiError(503, "invalid_configuration", "Server and browser Firebase projects must match.");
    return { provider, emailConfirmationRequired, passwordAuthEnabled, googleAuthEnabled, configured };
}
