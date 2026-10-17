import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseDocumentStore, type RpcCall } from "./document-store";
import { ApiError } from "./validation";
import { createAgentQueue, agentRetentionDays } from "./agent-queue";
export function supabaseAdmin() {
    const url = process.env.SUPABASE_INTERNAL_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new ApiError(503, "not_configured", "Shared workspace is not configured. Ask the administrator to finish Supabase setup.");
    const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const rpc: RpcCall = async (name, input) => {
        const { data, error } = await client.rpc(name, input);
        if (error)
            throw new ApiError(503, "database_unavailable", "The document database is unavailable. Retry shortly.");
        return data;
    };
    // Lazy: existing web operations do not require agent settings or migration
    // 014 until the internal queue is explicitly requested by its future caller.
    return { auth: client.auth, client, db: supabaseDocumentStore(rpc),
        agentQueue: (required: boolean) => createAgentQueue(rpc, required, agentRetentionDays()) };
}
