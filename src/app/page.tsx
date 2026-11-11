"use client";

import React, { useState, useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import Sidebar from "./components/Sidebar";
import NotionEditor from "./components/NotionEditor";
import DatabaseView from "./components/DatabaseView";
import SidePeek from "./components/SidePeek";
import CommandPalette from "./components/CommandPalette";
import {
  Star,
  ChevronRight,
  Menu,
} from "lucide-react";
import styles from "./page.module.css";

export default function HomePage() {
  const {
    blocks,
    activeBlockId,
    setActiveBlock,
    toggleFavorite,
    theme,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useWorkspace();

  const [searchOpen, setSearchOpen] = useState(false);

  // Set document data-theme attribute for CSS variable switching
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
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />

      {/* Main Workspace Stage */}
      <main className={styles.mainStage}>
        {/* Slim Topbar (Breadcrumbs, Favorite, Share, More) */}
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
              <span className={styles.crumbBtn}>openNotion</span>
            )}
          </div>

          <div className={styles.topbarActions}>
            {activeBlock && (
              <>
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
            <NotionEditor key={activeBlock.id} block={activeBlock} />
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
