"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block, SharePermission } from "@/lib/model";
import TeamspaceEditor from "@/app/components/TeamspaceEditor";
import DatabaseView from "@/app/components/DatabaseView";
import { Eye, Edit3, Lock, ArrowLeft, Sun, Moon } from "lucide-react";

type RemoteSharePayload = {
  share: {
    token: string;
    workspaceId: string;
    blockId: string;
    permission: SharePermission;
    enabled: boolean;
  };
  document: Record<string, unknown>;
};

export default function SharedPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";
  const { blocks, shareLinks, updateBlock, theme, toggleTheme } = useWorkspace();

  const localLink = token ? shareLinks?.[token] : undefined;
  const localBlock =
    localLink && localLink.enabled ? blocks[localLink.blockId] : undefined;

  const [remoteData, setRemoteData] = useState<RemoteSharePayload | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(!token || Boolean(localBlock));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!token || localBlock) {
      return;
    }
    let active = true;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RemoteSharePayload | null) => {
        if (active) {
          setRemoteData(data);
          setRemoteLoaded(true);
        }
      })
      .catch(() => {
        if (active) setRemoteLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [token, localBlock]);

  const permission: SharePermission =
    localLink?.permission || remoteData?.share.permission || "read";
  const isReadOnly = permission !== "edit";

  const sharedBlock: Block | null = localBlock
    ? localBlock
    : remoteData
      ? {
          id: remoteData.share.blockId,
          workspaceId: remoteData.share.workspaceId,
          parentId: null,
          type: "page",
          title: String(remoteData.document.title || "Untitled"),
          icon:
            typeof remoteData.document.icon === "string"
              ? remoteData.document.icon
              : "📄",
          coverUrl:
            typeof remoteData.document.coverUrl === "string"
              ? remoteData.document.coverUrl
              : null,
          content: (remoteData.document.content as Block["content"]) || {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
          position: "0",
          revision: Number(remoteData.document.revision || 1),
          createdAt: Number(remoteData.document.createdAt || 0),
          updatedAt: Number(remoteData.document.updatedAt || 0),
        }
      : null;

  if (!remoteLoaded && !localBlock) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-main)",
          color: "var(--text-secondary)",
        }}
      >
        Loading shared page...
      </div>
    );
  }

  if (!sharedBlock || (localLink && !localLink.enabled)) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          background: "var(--bg-main)",
          color: "var(--text-primary)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <Lock size={32} />
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>
          This shared link is unavailable
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", maxWidth: 420 }}>
          The link may have been revoked, disabled, or does not exist.
        </p>
        <Link
          href="/"
          style={{
            marginTop: 8,
            padding: "8px 14px",
            borderRadius: 6,
            background: "var(--accent-blue)",
            color: "#fff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Go to Teamspace
        </Link>
      </div>
    );
  }

  const handleRemoteOrLocalChange = (updates: Partial<Block>) => {
    if (isReadOnly) return;
    if (localBlock) {
      updateBlock(localBlock.id, updates);
    } else if (remoteData) {
      setRemoteData((prev) =>
        prev
          ? {
              ...prev,
              document: { ...prev.document, ...updates },
            }
          : prev
      );
      void fetch(`/api/share/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-primary)" }}>
      <header
        style={{
          height: 46,
          borderBottom: "1px solid var(--border-subtle)",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-sidebar)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={14} />
            <span>Teamspace</span>
          </Link>
          <span style={{ opacity: 0.35 }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {sharedBlock.icon || "📄"} {sharedBlock.title || "Untitled"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              fontWeight: 500,
              padding: "3px 9px",
              borderRadius: 999,
              background: isReadOnly
                ? "rgba(120, 120, 120, 0.14)"
                : "rgba(15, 123, 108, 0.14)",
              color: isReadOnly ? "var(--text-secondary)" : "#0f7b6c",
            }}
          >
            {isReadOnly ? <Eye size={12} /> : <Edit3 size={12} />}
            <span>{isReadOnly ? "Read-only" : "Can edit"}</span>
          </span>

          <button
            type="button"
            onClick={toggleTheme}
            style={{
              padding: "5px 7px",
              borderRadius: 6,
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        {sharedBlock.type === "database" ? (
          <DatabaseView block={sharedBlock} readOnly={isReadOnly} />
        ) : (
          <TeamspaceEditor
            key={sharedBlock.id}
            block={sharedBlock}
            readOnly={isReadOnly}
            onBlockChange={handleRemoteOrLocalChange}
          />
        )}
      </main>
    </div>
  );
}
