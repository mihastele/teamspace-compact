"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import { useTeamspace } from "@/lib/client";
import Sidebar from "./components/Sidebar";
import TeamspaceEditor from "./components/TeamspaceEditor";
import DatabaseView from "./components/DatabaseView";
import SidePeek from "./components/SidePeek";
import CommandPalette from "./components/CommandPalette";
import AuthPanel from "./components/AuthPanel";
import { ContextMenuHost } from "./components/ContextMenu";
import {
  Star,
  ChevronRight,
  Menu,
  Sparkles,
  MoreHorizontal,
  Copy,
  Download,
  Trash2,
  Share2,
  Check,
  ExternalLink,
} from "lucide-react";
import styles from "./page.module.css";

export default function HomePage() {
  const api = useTeamspace();
  const {
    blocks,
    activeBlockId,
    setActiveBlock,
    toggleFavorite,
    updateBlock,
    duplicateBlock,
    archiveBlock,
    theme,
    sidebarCollapsed,
    setSidebarCollapsed,
    syncFromApi,
    shareLinks,
    createOrGetShareLink,
    updateShareLink,
    revokeShareLink,
    syncShareLink,
  } = useWorkspace();

  const [searchOpen, setSearchOpen] = useState(false);
  const [showAppearanceMenu, setShowAppearanceMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const appearanceMenuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  // Sync workspace and server items into workspace-store whenever api data updates
  useEffect(() => {
    if (api.workspace) {
      syncFromApi(
        api.workspace,
        api.notes,
        api.tasks
      );
    }
  }, [api.workspace, api.notes, api.tasks, syncFromApi]);

  // Click outside and Escape listener for appearance menu
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        appearanceMenuRef.current &&
        !appearanceMenuRef.current.contains(e.target as Node)
      ) {
        setShowAppearanceMenu(false);
      }
      if (
        shareMenuRef.current &&
        !shareMenuRef.current.contains(e.target as Node)
      ) {
        setShowShareMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAppearanceMenu(false);
        setShowShareMenu(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Keyboard shortcut for Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 1. Loading State when connecting to remote workspace
  if (api.loading && !api.workspace) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingBox}>
          <Sparkles className={styles.loadingIcon} size={24} />
          <span>Opening your workspace…</span>
        </div>
      </div>
    );
  }

  // 2. Authentication Gate: If connected backend is configured and requires login
  if (
    api.configured &&
    (!api.user ||
      api.needsEmailConfirmation ||
      api.passwordRecovery ||
      api.authConfigurationError)
  ) {
    return (
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <div className={styles.authHeader}>
            <span className={styles.brandMark}>N</span>
            <h1>Welcome to Teamspace</h1>
            <p>Sign in to collaborate on your team’s docs, tasks, and databases.</p>
          </div>
          <AuthPanel api={api} />
        </div>
      </div>
    );
  }

  const activeBlock = activeBlockId ? blocks[activeBlockId] : null;

  // Build breadcrumbs for nested pages
  const breadcrumbs: { id: string; title: string; icon?: string | null }[] = [];
  let curr = activeBlock;
  while (curr) {
    breadcrumbs.unshift({ id: curr.id, title: curr.title || "Untitled", icon: curr.icon });
    curr = curr.parentId ? blocks[curr.parentId] : null;
  }

  return (
    <div className={styles.appShell} data-theme={theme}>
      {/* Collapsible Notion-like Sidebar */}
      <ContextMenuHost />
      <Sidebar api={api} onOpenSearch={() => setSearchOpen(true)} />

      {/* Main Workspace Stage */}
      <main className={styles.mainStage}>
        {/* Slim Topbar (Breadcrumbs, Favorite, Share, Search) */}
        <header className={styles.topbar}>
          <div className={styles.breadcrumbsArea}>
            {sidebarCollapsed && (
              <button
                className={styles.menuToggleBtn}
                title="Expand sidebar"
                onClick={() => setSidebarCollapsed(false)}
              >
                <Menu size={16} />
              </button>
            )}

            {breadcrumbs.length > 0 ? (
              breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <ChevronRight size={13} className={styles.crumbDivider} />}
                  <button
                    className={`${styles.crumbBtn} ${idx === breadcrumbs.length - 1 ? styles.crumbBtnActive : ""}`}
                    onClick={() => setActiveBlock(crumb.id)}
                  >
                    <span>{crumb.icon || "📄"}</span>
                    <span>{crumb.title}</span>
                  </button>
                </React.Fragment>
              ))
            ) : (
              <span className={styles.crumbBtn}>Teamspace</span>
            )}
          </div>

          <div className={styles.topbarActions}>
            {activeBlock && (
              <>
                <div style={{ position: "relative" }} ref={shareMenuRef}>
                  <button
                    className={styles.topbarBtn}
                    title="Share page via link"
                    onClick={() => setShowShareMenu((prev) => !prev)}
                  >
                    <Share2 size={14} />
                    <span>Share</span>
                  </button>

                  {showShareMenu && (() => {
                    const activeShare = Object.values(shareLinks || {}).find(
                      (s) => s.blockId === activeBlock.id
                    );
                    const sharePath = activeShare ? `/share/${activeShare.token}` : "";
                    const shareUrl =
                      typeof window !== "undefined" && sharePath
                        ? `${window.location.origin}${sharePath}`
                        : sharePath;

                    return (
                      <div className={styles.appearancePopover} style={{ width: 300, padding: 14 }}>
                        <div className={styles.appearanceSectionHeader} style={{ marginBottom: 6 }}>
                          Share via link
                        </div>
                        {!activeShare || !activeShare.enabled ? (
                          <button
                            className={styles.appearanceActionItem}
                            style={{
                              background: "var(--accent-blue)",
                              color: "#fff",
                              justifyContent: "center",
                              marginTop: 4,
                            }}
                            onClick={() => createOrGetShareLink(activeBlock.id, "read")}
                          >
                            <Share2 size={13} />
                            <span>Create public share link</span>
                          </button>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                className={`${styles.fontOptionBtn} ${activeShare.permission === "read" ? styles.fontOptionBtnActive : ""}`}
                                onClick={() => updateShareLink(activeShare.token, { permission: "read" })}
                              >
                                Read-only
                              </button>
                              <button
                                className={`${styles.fontOptionBtn} ${activeShare.permission === "edit" ? styles.fontOptionBtnActive : ""}`}
                                onClick={() => updateShareLink(activeShare.token, { permission: "edit" })}
                              >
                                Can edit
                              </button>
                            </div>

                            <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                              <input
                                readOnly
                                value={shareUrl}
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                                style={{
                                  flex: 1,
                                  fontSize: 12,
                                  padding: "6px 8px",
                                  borderRadius: 6,
                                  border: "1px solid var(--border-subtle)",
                                  background: "var(--bg-main)",
                                  color: "var(--text-primary)",
                                  minWidth: 0,
                                }}
                              />
                              <button
                                onClick={() => {
                                  syncShareLink(activeShare, activeBlock);
                                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                                    void navigator.clipboard.writeText(shareUrl);
                                    setCopiedShare(true);
                                    setTimeout(() => setCopiedShare(false), 1500);
                                  }
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  background: "var(--accent-blue)",
                                  color: "#fff",
                                  border: "none",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  flexShrink: 0,
                                }}
                              >
                                {copiedShare ? <Check size={13} /> : <Copy size={13} />}
                                <span>{copiedShare ? "Copied!" : "Copy"}</span>
                              </button>
                            </div>

                            <a
                              href={sharePath}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                padding: "7px 10px",
                                fontSize: 12,
                                fontWeight: 500,
                                borderRadius: 6,
                                border: "1px solid var(--border-subtle)",
                                background: "var(--bg-secondary)",
                                color: "var(--text-primary)",
                                textDecoration: "none",
                              }}
                              title="Open shared page in a new tab"
                            >
                              <ExternalLink size={13} />
                              <span>Open in new tab</span>
                            </a>

                            <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "2px 0" }} />

                            <button
                              className={`${styles.appearanceActionItem} ${styles.appearanceActionDanger}`}
                              style={{ justifyContent: "center" }}
                              onClick={() => revokeShareLink(activeShare.token)}
                            >
                              <Trash2 size={13} />
                              <span>Disable &amp; revoke link</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <button
                  className={`${styles.topbarBtn} ${activeBlock.isFavorite ? styles.favorited : ""}`}
                  title={activeBlock.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                  onClick={() => toggleFavorite(activeBlock.id)}
                >
                  <Star size={15} fill={activeBlock.isFavorite ? "currentColor" : "none"} />
                </button>
                <div className={styles.divider} />
              </>
            )}

            <button
              className={styles.topbarBtn}
              title="Quick Find (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <span>Search</span>
              <kbd className={styles.topbarKbd}>⌘K</kbd>
            </button>

            {/* Notion-style Page & View Appearance Menu (•••) */}
            {activeBlock && (
              <div style={{ position: "relative" }} ref={appearanceMenuRef}>
                <button
                  className={styles.topbarBtn}
                  title="Page settings"
                  onClick={() => setShowAppearanceMenu((prev) => !prev)}
                >
                  <MoreHorizontal size={16} />
                </button>

                {showAppearanceMenu && (
                  <div className={styles.appearancePopover}>
                    <div className={styles.appearanceSectionHeader}>Style</div>
                    <div className={styles.fontOptionGroup}>
                      {(["sans", "serif", "mono"] as const).map((font) => (
                        <button
                          key={font}
                          className={`${styles.fontOptionBtn} ${activeBlock.fontStyle === font || (!activeBlock.fontStyle && font === "sans") ? styles.fontOptionBtnActive : ""}`}
                          onClick={() => {
                            updateBlock(activeBlock.id, { fontStyle: font });
                          }}
                        >
                          <span style={{ fontSize: 13, textTransform: "capitalize" }}>{font}</span>
                        </button>
                      ))}
                    </div>

                    <div className={styles.appearanceDivider} />

                    <div
                      className={styles.appearanceRow}
                      onClick={() => {
                        updateBlock(activeBlock.id, { isFullWidth: !activeBlock.isFullWidth });
                      }}
                    >
                      <span>Full width</span>
                      <input
                        type="checkbox"
                        checked={Boolean(activeBlock.isFullWidth)}
                        readOnly
                        style={{ cursor: "pointer", accentColor: "var(--accent-blue)" }}
                      />
                    </div>

                    <div className={styles.appearanceDivider} />

                    <button
                      className={styles.appearanceActionItem}
                      onClick={() => {
                        duplicateBlock(activeBlock.id);
                        setShowAppearanceMenu(false);
                      }}
                    >
                      <Copy size={13} />
                      <span>Duplicate</span>
                    </button>

                    <button
                      className={styles.appearanceActionItem}
                      onClick={() => {
                        const md = `# ${activeBlock.title || "Untitled"}\n\nExported from Teamspace`;
                        const blob = new Blob([md], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${activeBlock.title || "page"}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                        setShowAppearanceMenu(false);
                      }}
                    >
                      <Download size={13} />
                      <span>Export as Markdown</span>
                    </button>

                    <div className={styles.appearanceDivider} />

                    <button
                      className={`${styles.appearanceActionItem} ${styles.appearanceActionDanger}`}
                      onClick={() => {
                        archiveBlock(activeBlock.id);
                        setShowAppearanceMenu(false);
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Content Canvas */}
        <div className={styles.scrollCanvas}>
          {!activeBlock ? (
            <div className={styles.emptyState}>
              <h2>Select or create a page</h2>
              <p>Choose an item from the sidebar to view or edit.</p>
            </div>
          ) : activeBlock.type === "database" ? (
            <DatabaseView key={activeBlock.id} block={activeBlock} />
          ) : (
            <TeamspaceEditor key={activeBlock.id} block={activeBlock} />
          )}
        </div>
      </main>

      {/* Side Peek Drawer */}
      <SidePeek />

      {/* Global Command Palette / Search Modal */}
      <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
