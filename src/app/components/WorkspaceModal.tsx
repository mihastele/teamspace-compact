"use client";

import React, { useState } from "react";
import type { useTeamspace } from "@/lib/client";
import { X, Plus, KeyRound } from "lucide-react";
import styles from "./WorkspaceModal.module.css";

type Api = ReturnType<typeof useTeamspace>;

export default function WorkspaceModal({
  api,
  isOpen,
  onClose,
}: {
  api: Api;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createWorkspace(name.trim());
      setName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      let cleanToken = token.trim();
      try {
        cleanToken = new URL(cleanToken).searchParams.get("invite") || cleanToken;
      } catch {
        // Raw token
      }
      await api.joinWorkspace(cleanToken);
      setToken("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tabBtn} ${tab === "create" ? styles.tabBtnActive : ""}`}
              onClick={() => setTab("create")}
            >
              <Plus size={14} />
              <span>Create Workspace</span>
            </button>
            <button
              className={`${styles.tabBtn} ${tab === "join" ? styles.tabBtnActive : ""}`}
              onClick={() => setTab("join")}
            >
              <KeyRound size={14} />
              <span>Join with Invite</span>
            </button>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          {tab === "create" ? (
            <form onSubmit={handleCreate} className={styles.form}>
              <label className={styles.label}>
                Workspace Name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  className={styles.input}
                  placeholder="e.g. Acme Corp, Engineering Team"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={busy || !name.trim()}
              >
                {busy ? "Creating…" : "Create Workspace"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className={styles.form}>
              <label className={styles.label}>
                Invitation Token or Link
                <input
                  autoFocus
                  required
                  className={styles.input}
                  placeholder="Paste invite link or token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={busy || !token.trim()}
              >
                {busy ? "Joining…" : "Join Workspace"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
