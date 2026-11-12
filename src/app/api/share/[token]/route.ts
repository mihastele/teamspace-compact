import { NextRequest, NextResponse } from "next/server";
import { backendConfiguration } from "@/lib/server/backend-config";
import { supabaseAdmin } from "@/lib/server/supabase";

type ShareRow = {
  token: string;
  workspace_id: string;
  block_id: string;
  permission: "read" | "edit";
  enabled: boolean;
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  if (backendConfiguration().provider !== "supabase") {
    return NextResponse.json({ error: "Remote share not configured." }, { status: 404 });
  }

  try {
    const admin = supabaseAdmin().client;
    const { data: shareRow, error: shareErr } = await admin
      .from("teamspace_share_links")
      .select("token, workspace_id, block_id, permission, enabled")
      .eq("token", token)
      .maybeSingle<ShareRow>();

    if (shareErr || !shareRow || !shareRow.enabled) {
      return NextResponse.json({ error: "Share link not found." }, { status: 404 });
    }

    const { data: docRow, error: docErr } = await admin
      .from("teamspace_documents")
      .select("document_id, data")
      .eq("workspace_id", shareRow.workspace_id)
      .eq("document_id", shareRow.block_id)
      .maybeSingle<{ document_id: string; data: Record<string, unknown> }>();

    if (docErr || !docRow) {
      return NextResponse.json({ error: "Shared page not found." }, { status: 404 });
    }

    return NextResponse.json({
      share: {
        token: shareRow.token,
        workspaceId: shareRow.workspace_id,
        blockId: shareRow.block_id,
        permission: shareRow.permission,
        enabled: shareRow.enabled,
      },
      document: docRow.data,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load shared page." }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || !/^[a-zA-Z0-9_-]{4,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid share token." }, { status: 400 });
  }

  if (backendConfiguration().provider !== "supabase") {
    return NextResponse.json({ error: "Remote share not configured." }, { status: 404 });
  }

  let body: { title?: unknown; content?: unknown; icon?: unknown } = {};
  try {
    body = (await req.json()) as { title?: unknown; content?: unknown; icon?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin().client;
    const { data: shareRow, error: shareErr } = await admin
      .from("teamspace_share_links")
      .select("token, workspace_id, block_id, permission, enabled")
      .eq("token", token)
      .maybeSingle<ShareRow>();

    if (shareErr || !shareRow || !shareRow.enabled) {
      return NextResponse.json({ error: "Share link not found." }, { status: 404 });
    }

    if (shareRow.permission !== "edit") {
      return NextResponse.json({ error: "This share link is read-only." }, { status: 403 });
    }

    const { data: docRow } = await admin
      .from("teamspace_documents")
      .select("data")
      .eq("workspace_id", shareRow.workspace_id)
      .eq("document_id", shareRow.block_id)
      .maybeSingle<{ data: Record<string, unknown> }>();

    if (!docRow) {
      return NextResponse.json({ error: "Shared page not found." }, { status: 404 });
    }

    const nextData: Record<string, unknown> = { ...docRow.data };
    if (typeof body.title === "string") nextData.title = body.title.slice(0, 200);
    if (body.content !== undefined) nextData.content = body.content;
    if (body.icon === null || typeof body.icon === "string") nextData.icon = body.icon;
    nextData.updatedAt = Date.now();

    const { error: updateErr } = await admin
      .from("teamspace_documents")
      .update({ data: nextData })
      .eq("workspace_id", shareRow.workspace_id)
      .eq("document_id", shareRow.block_id);

    if (updateErr) {
      return NextResponse.json({ error: "Failed to save changes." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save shared page." }, { status: 500 });
  }
}
