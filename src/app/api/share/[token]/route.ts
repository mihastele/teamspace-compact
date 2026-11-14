import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase";

type ShareRow = {
  token: string;
  workspace_id: string;
  block_id: string;
  permission: "read" | "edit";
  enabled: boolean;
  data: Record<string, unknown>;
};

// Global in-memory cache for ultra-fast access & local fallback across windows / environments
const memoryShareStore = new Map<
  string,
  {
    share: {
      token: string;
      workspaceId: string;
      blockId: string;
      permission: "read" | "edit";
      enabled: boolean;
    };
    document: Record<string, unknown>;
  }
>();

function getSupabaseClient() {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return supabaseAdmin().client;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  // 1. Check in-memory store
  const cached = memoryShareStore.get(token);
  if (cached) {
    if (!cached.share.enabled) {
      return NextResponse.json({ error: "Share link disabled." }, { status: 404 });
    }
    return NextResponse.json(cached);
  }

  // 2. Check Supabase
  const admin = getSupabaseClient();
  if (admin) {
    try {
      const { data: shareRow, error: shareErr } = await admin
        .from("teamspace_share_links")
        .select("token, workspace_id, block_id, permission, enabled, data")
        .eq("token", token)
        .maybeSingle<ShareRow>();

      if (!shareErr && shareRow && shareRow.enabled) {
        const payload = {
          share: {
            token: shareRow.token,
            workspaceId: shareRow.workspace_id,
            blockId: shareRow.block_id,
            permission: shareRow.permission,
            enabled: shareRow.enabled,
          },
          document: (shareRow.data as Record<string, unknown>) || {},
        };
        memoryShareStore.set(token, payload);
        return NextResponse.json(payload);
      }
    } catch {
      // Fallback
    }
  }

  return NextResponse.json({ error: "Share link not found." }, { status: 404 });
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  let body: {
    workspaceId?: string;
    blockId?: string;
    permission?: "read" | "edit";
    enabled?: boolean;
    document?: Record<string, unknown>;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "workspace-default";
  const blockId = typeof body.blockId === "string" ? body.blockId : "";
  const permission: "read" | "edit" = body.permission === "edit" ? "edit" : "read";
  const enabled = body.enabled !== false;
  const document = body.document && typeof body.document === "object" ? body.document : {};

  const payload = {
    share: {
      token,
      workspaceId,
      blockId,
      permission,
      enabled,
    },
    document,
  };
  memoryShareStore.set(token, payload);

  const admin = getSupabaseClient();
  if (admin) {
    try {
      await admin.from("teamspace_share_links").upsert({
        token,
        workspace_id: workspaceId,
        block_id: blockId,
        permission,
        enabled,
        data: document,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to persist share link to Supabase:", err);
    }
  }

  return NextResponse.json({ ok: true, payload });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  let body: { title?: unknown; content?: unknown; icon?: unknown; coverUrl?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let existing = memoryShareStore.get(token);
  const admin = getSupabaseClient();

  if (!existing && admin) {
    try {
      const { data: shareRow } = await admin
        .from("teamspace_share_links")
        .select("token, workspace_id, block_id, permission, enabled, data")
        .eq("token", token)
        .maybeSingle<ShareRow>();
      if (shareRow) {
        existing = {
          share: {
            token: shareRow.token,
            workspaceId: shareRow.workspace_id,
            blockId: shareRow.block_id,
            permission: shareRow.permission,
            enabled: shareRow.enabled,
          },
          document: (shareRow.data as Record<string, unknown>) || {},
        };
      }
    } catch {
      // ignore
    }
  }

  if (!existing || !existing.share.enabled) {
    return NextResponse.json({ error: "Share link not found or disabled." }, { status: 404 });
  }

  if (existing.share.permission !== "edit") {
    return NextResponse.json({ error: "This share link is read-only." }, { status: 403 });
  }

  const nextDoc = { ...existing.document };
  if (typeof body.title === "string") nextDoc.title = body.title.slice(0, 200);
  if (body.content !== undefined) nextDoc.content = body.content;
  if (body.icon === null || typeof body.icon === "string") nextDoc.icon = body.icon;
  if (body.coverUrl === null || typeof body.coverUrl === "string") nextDoc.coverUrl = body.coverUrl;
  nextDoc.updatedAt = Date.now();

  const updatedPayload = {
    ...existing,
    document: nextDoc,
  };
  memoryShareStore.set(token, updatedPayload);

  if (admin) {
    try {
      await admin
        .from("teamspace_share_links")
        .update({ data: nextDoc, updated_at: new Date().toISOString() })
        .eq("token", token);
    } catch (err) {
      console.error("Failed to update shared doc in Supabase:", err);
    }
  }

  return NextResponse.json({ ok: true, document: nextDoc });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  const existing = memoryShareStore.get(token);
  if (existing) {
    existing.share.enabled = false;
    memoryShareStore.set(token, existing);
  }

  const admin = getSupabaseClient();
  if (admin) {
    try {
      await admin
        .from("teamspace_share_links")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("token", token);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true });
}
