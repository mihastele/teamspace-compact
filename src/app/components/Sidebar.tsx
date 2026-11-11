"use client";

import React, { useState } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type { useTeamspace } from "@/lib/client";
import WorkspaceModal from "./WorkspaceModal";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Sun,
  Moon,
  Table2,
  Star,
  MoreHorizontal,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  LogOut,
  User,
} from "lucide-react";
import styles from "./Sidebar.module.css";

type Api = ReturnType<typeof useTeamspace>;

export default function Sidebar({
  api,
  onOpenSearch,
}: {
  api?: Api;
  onOpenSearch: () => void;
}) {
  const {
    workspace,
    blocks,
    childrenIndex,
    activeBlockId,
    setActiveBlock,
    createPage,
    createDatabase,
    archiveBlock,
    restoreBlock,
    toggleFavorite,
    theme,
    toggleTheme,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useWorkspace();

  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    "page-engineering-wiki": true,
    "database-tasks": false,
  });
  const [showTrash, setShowTrash] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [menuOpenBlockId, setMenuOpenBlockId] = useState<string | null>(null);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const rootBlockIds = (childrenIndex["root"] || []).filter(
    (id) => !blocks[id]?.isArchived
  );
  const favoriteBlockIds = Object.keys(blocks).filter(
    (id) => blocks[id]?.isFavorite && !blocks[id]?.isArchived
  );
  const archivedBlocks = Object.values(blocks).filter((b) => b.isArchived);

  const renderTreeItem = (blockId: string, level: number = 0) => {
    const block = blocks[blockId];
    if (!block || block.isArchived) return null;

    const childIds = (childrenIndex[blockId] || []).filter(
      (cid) => !blocks[cid]?.isArchived
    );
    const hasChildren = childIds.length > 0;
    const isExpanded = !!expandedNodes[blockId];
    const isActive = activeBlockId === blockId;

    return (
      <div key={block.id} className={styles.treeNode}>
        <div
          className={`${styles.treeRow} ${isActive ? styles.treeRowActive : ""}`}
          style={{ paddingLeft: `${12 + level * 14}px` }}
          onClick={() => setActiveBlock(block.id)}
        >
          <button
            className={`${styles.chevronBtn} ${!hasChildren ? styles.chevronHidden : ""}`}
            onClick={(e) => toggleExpand(block.id, e)}
            aria-label="Toggle child pages"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          <span className={styles.itemIcon}>
            {block.icon || (block.type === "database" ? "🗂️" : "📄")}
          </span>

          <span className={styles.itemTitle}>{block.title || "Untitled"}</span>

          <div className={styles.hoverActions}>
            <button
              className={styles.actionBtn}
              title="Add subpage"
              onClick={(e) => {
                e.stopPropagation();
                const newPage = createPage(block.id, "Untitled Subpage");
                setExpandedNodes((prev) => ({ ...prev, [block.id]: true }));
                setActiveBlock(newPage.id);
              }}
            >
              <Plus size={14} />
            </button>
            <button
              className={styles.actionBtn}
              title="Options"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenBlockId(menuOpenBlockId === block.id ? null : block.id);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>

          {menuOpenBlockId === block.id && (
            <div
              className={styles.contextMenu}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className={styles.menuItem}
                onClick={() => {
                  toggleFavorite(block.id);
                  setMenuOpenBlockId(null);
                }}
              >
                <Star size={13} />
                {block.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              </button>
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  archiveBlock(block.id);
                  setMenuOpenBlockId(null);
                }}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div className={styles.treeChildren}>
            {childIds.map((cid) => renderTreeItem(cid, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (sidebarCollapsed) {
    return (
      <aside className={styles.collapsedSidebar}>
        <button
          className={styles.expandSidebarBtn}
          title="Expand sidebar"
          onClick={() => setSidebarCollapsed(false)}
        >
          <ChevronsRight size={18} />
        </button>
      </aside>
    );
  }

  const currentWorkspaceName = api?.workspace?.name || workspace.name;
  const workspacesList = api?.workspaces || [{ id: workspace.id, name: workspace.name, ownerId: workspace.ownerId }];
  const currentUser = api?.user;

  return (
    <aside className={styles.sidebar}>
      {/* Workspace Header Switcher */}
      <div className={styles.header}>
        <div
          className={styles.workspaceInfo}
          onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
          title="Switch workspace"
        >
          <span className={styles.workspaceIcon}>{workspace.icon || "🚀"}</span>
          <span className={styles.workspaceName}>{currentWorkspaceName}</span>
          <ChevronDown size={14} className={styles.workspaceChevron} />
        </div>
        <button
          className={styles.collapseBtn}
          title="Collapse sidebar"
          onClick={() => setSidebarCollapsed(true)}
        >
          <ChevronsLeft size={16} />
        </button>
      </div>

      {/* Workspace Switcher Dropdown */}
      {showWorkspaceMenu && (
        <div className={styles.workspaceDropdown}>
          <div className={styles.dropdownHeader}>Workspaces</div>
          {workspacesList.map((w) => (
            <button
              key={w.id}
              className={`${styles.dropdownItem} ${w.id === (api?.workspace?.id || workspace.id) ? styles.dropdownItemActive : ""}`}
              onClick={() => {
                if (api && w.id !== api.workspace?.id) {
                  api.selectWorkspace(w.id);
                }
                setShowWorkspaceMenu(false);
              }}
            >
              <span>🚀</span>
              <span className={styles.dropdownItemName}>{w.name}</span>
            </button>
          ))}

          {api && (
            <button
              className={styles.dropdownAddBtn}
              onClick={() => {
                setShowWorkspaceMenu(false);
                setShowWorkspaceModal(true);
              }}
            >
              <Plus size={14} />
              <span>Create or join workspace</span>
            </button>
          )}
        </div>
      )}

      {/* Quick Nav Tools */}
      <div className={styles.quickNav}>
        <button className={styles.quickNavBtn} onClick={onOpenSearch}>
          <Search size={15} />
          <span>Search</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
        <button className={styles.quickNavBtn} onClick={toggleTheme}>
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
        </button>
      </div>

      <div className={styles.scrollableContent}>
        {/* Favorites */}
        {favoriteBlockIds.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>Favorites</span>
            </div>
            {favoriteBlockIds.map((id) => renderTreeItem(id, 0))}
          </div>
        )}

        {/* Workspace Pages Tree */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>Workspace</span>
            <div className={styles.sectionActions}>
              <button
                className={styles.addPageBtn}
                title="New Page"
                onClick={() => createPage(null, "Untitled")}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {rootBlockIds.length === 0 ? (
            <div className={styles.emptyNote}>No pages in workspace</div>
          ) : (
            rootBlockIds.map((id) => renderTreeItem(id, 0))
          )}
        </div>
      </div>

      {/* Bottom Actions: New Database, Trash, User Profile */}
      <div className={styles.bottomBar}>
        <button
          className={styles.bottomBtn}
          onClick={() => createDatabase(null, "New Database")}
        >
          <Table2 size={15} />
          <span>New Database</span>
        </button>
        <button
          className={styles.bottomBtn}
          onClick={() => setShowTrash(!showTrash)}
        >
          <Trash2 size={15} />
          <span>Trash {archivedBlocks.length > 0 && `(${archivedBlocks.length})`}</span>
        </button>

        {/* Account Info / Sign Out */}
        <div className={styles.userSection}>
          <div className={styles.userInfo}>
            <div className={styles.avatar}>
              {currentUser?.displayName?.[0]?.toUpperCase() || <User size={13} />}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>
                {currentUser?.displayName || "Local explorer"}
              </span>
              <span className={styles.userStatus}>
                {api?.configured ? (currentUser?.email || "Signed in") : "Preview mode"}
              </span>
            </div>
          </div>
          {api?.configured && currentUser && (
            <button
              className={styles.signOutBtn}
              title="Sign out"
              onClick={() => void api.signOut()}
            >
              <LogOut size={14} />
            </button>
          )}
        </div>

        {showTrash && (
          <div className={styles.trashModal}>
            <div className={styles.trashHeader}>
              <span>Trash</span>
              <button
                className={styles.trashCloseBtn}
                onClick={() => setShowTrash(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.trashList}>
              {archivedBlocks.length === 0 ? (
                <div className={styles.trashEmpty}>Trash is empty</div>
              ) : (
                archivedBlocks.map((b) => (
                  <div key={b.id} className={styles.trashRow}>
                    <span>{b.title || "Untitled"}</span>
                    <button
                      className={styles.restoreBtn}
                      title="Restore"
                      onClick={() => restoreBlock(b.id)}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Workspace Creation & Join Modal */}
      {api && (
        <WorkspaceModal
          api={api}
          isOpen={showWorkspaceModal}
          onClose={() => setShowWorkspaceModal(false)}
        />
      )}
    </aside>
  );
}
