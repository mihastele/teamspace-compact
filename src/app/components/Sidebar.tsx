"use client";

import React, { useState, useEffect, useRef } from "react";
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
  Copy,
  Edit2,
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
    duplicateBlock,
    updateBlock,
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
  const [contextMenu, setContextMenu] = useState<{
    blockId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingBlockId, setRenamingBlockId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLDivElement>(null);
  const trashModalRef = useRef<HTMLDivElement>(null);
  const trashTriggerRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape handlers for all floating popovers
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showWorkspaceMenu &&
        workspaceMenuRef.current &&
        !workspaceMenuRef.current.contains(target) &&
        !workspaceTriggerRef.current?.contains(target)
      ) {
        setShowWorkspaceMenu(false);
      }

      if (
        showTrash &&
        trashModalRef.current &&
        !trashModalRef.current.contains(target) &&
        !trashTriggerRef.current?.contains(target)
      ) {
        setShowTrash(false);
      }

      if (
        contextMenu &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(target)
      ) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowWorkspaceMenu(false);
        setShowTrash(false);
        setContextMenu(null);
        setRenamingBlockId(null);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showWorkspaceMenu, showTrash, contextMenu]);

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

  const openContextMenu = (
    blockId: string,
    x: number,
    y: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      blockId,
      x: Math.min(x, window.innerWidth - 180),
      y: Math.min(y, window.innerHeight - 200),
    });
  };

  const handleStartRename = (blockId: string) => {
    const b = blocks[blockId];
    if (b) {
      setRenamingBlockId(blockId);
      setRenameValue(b.title || "");
    }
  };

  const handleSaveRename = (blockId: string) => {
    if (renamingBlockId === blockId) {
      updateBlock(blockId, { title: renameValue.trim() || "Untitled" });
      setRenamingBlockId(null);
    }
  };

  const renderTreeItem = (blockId: string, level: number = 0) => {
    const block = blocks[blockId];
    if (!block || block.isArchived) return null;

    const childIds = (childrenIndex[blockId] || []).filter(
      (cid) => !blocks[cid]?.isArchived
    );
    const hasChildren = childIds.length > 0;
    const isExpanded = !!expandedNodes[blockId];
    const isActive = activeBlockId === blockId;
    const isRenaming = renamingBlockId === blockId;

    return (
      <div key={block.id} className={styles.treeNode}>
        <div
          className={`${styles.treeRow} ${isActive ? styles.treeRowActive : ""}`}
          style={{ paddingLeft: `${12 + level * 14}px` }}
          onClick={() => {
            if (!isRenaming) {
              setActiveBlock(block.id);
            }
          }}
          onContextMenu={(e) => openContextMenu(block.id, e.clientX, e.clientY, e)}
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

          {isRenaming ? (
            <input
              autoFocus
              className={styles.renameInput}
              value={renameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleSaveRename(block.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSaveRename(block.id);
                } else if (e.key === "Escape") {
                  setRenamingBlockId(null);
                }
              }}
            />
          ) : (
            <span className={styles.itemTitle}>{block.title || "Untitled"}</span>
          )}

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
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openContextMenu(block.id, rect.right + 4, rect.top, e);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
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
          ref={workspaceTriggerRef}
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
        <div ref={workspaceMenuRef} className={styles.workspaceDropdown}>
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
          ref={trashTriggerRef}
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
          <div ref={trashModalRef} className={styles.trashModal}>
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

      {/* Floating Context Menu for Pages / Items */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.floatingContextMenu}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {blocks[contextMenu.blockId] && (
            <>
              <button
                className={styles.menuItem}
                onClick={() => {
                  toggleFavorite(contextMenu.blockId);
                  setContextMenu(null);
                }}
              >
                <Star size={13} />
                <span>
                  {blocks[contextMenu.blockId].isFavorite
                    ? "Remove from Favorites"
                    : "Add to Favorites"}
                </span>
              </button>
              <button
                className={styles.menuItem}
                onClick={() => {
                  handleStartRename(contextMenu.blockId);
                  setContextMenu(null);
                }}
              >
                <Edit2 size={13} />
                <span>Rename</span>
              </button>
              <button
                className={styles.menuItem}
                onClick={() => {
                  const newPage = createPage(contextMenu.blockId, "Untitled Subpage");
                  setExpandedNodes((prev) => ({ ...prev, [contextMenu.blockId]: true }));
                  setActiveBlock(newPage.id);
                  setContextMenu(null);
                }}
              >
                <Plus size={13} />
                <span>Add subpage</span>
              </button>
              <button
                className={styles.menuItem}
                onClick={() => {
                  duplicateBlock(contextMenu.blockId);
                  setContextMenu(null);
                }}
              >
                <Copy size={13} />
                <span>Duplicate</span>
              </button>
              <div className={styles.menuDivider} />
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  archiveBlock(contextMenu.blockId);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      )}

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
