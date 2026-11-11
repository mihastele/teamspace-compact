"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block } from "@/lib/model";
import {
  Table2,
  Kanban,
  Calendar,
  List as ListIcon,
  Plus,
  Search,
  ExternalLink,
  Copy,
  Trash2,
  Maximize2,
  ArrowRight,
} from "lucide-react";
import styles from "./DatabaseView.module.css";

export default function DatabaseView({ block }: { block: Block }) {
  const {
    blocks,
    childrenIndex,
    properties,
    views,
    activeViewIdByDatabase,
    setActiveView,
    createDatabaseRow,
    updateRowProperty,
    setSidePeekBlock,
    setActiveBlock,
    updateBlock,
    duplicateBlock,
    archiveBlock,
  } = useWorkspace();

  const dbProperties = properties[block.id] || [];
  const dbViews = views[block.id] || [];
  const activeViewId = activeViewIdByDatabase[block.id] || dbViews[0]?.id;
  const currentView = dbViews.find((v) => v.id === activeViewId) || dbViews[0];

  const rowIds = (childrenIndex[block.id] || []).filter(
    (id) => !blocks[id]?.isArchived
  );
  const rows = rowIds.map((id) => blocks[id]).filter(Boolean);

  const [searchFilter, setSearchFilter] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    rowId: string;
    x: number;
    y: number;
  } | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const filteredRows = rows.filter((row) =>
    (row.title || "").toLowerCase().includes(searchFilter.toLowerCase())
  );

  const statusProp = dbProperties.find((p) => p.type === "status");
  const priorityProp = dbProperties.find((p) => p.id === "prop-priority");

  const renderStatusPill = (statusId: unknown) => {
    const opt = statusProp?.options?.find((o) => o.id === statusId);
    if (!opt) return <span className={styles.emptyCell}>Empty</span>;
    return (
      <span className={`${styles.pill} ${styles[`pill_${opt.color || "default"}`]}`}>
        {opt.name}
      </span>
    );
  };

  const renderPriorityPill = (priorityId: unknown) => {
    const opt = priorityProp?.options?.find((o) => o.id === priorityId);
    if (!opt) return <span className={styles.emptyCell}>-</span>;
    return (
      <span className={`${styles.pill} ${styles[`pill_${opt.color || "default"}`]}`}>
        {opt.name}
      </span>
    );
  };

  const openContextMenu = (rowId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      rowId,
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 240),
    });
  };

  return (
    <div className={styles.databaseContainer}>
      {/* Database Title & Header */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.icon}>{block.icon || "🗂️"}</span>
          <input
            className={styles.titleInput}
            value={block.title}
            onChange={(e) => updateBlock(block.id, { title: e.target.value })}
            placeholder="Untitled Database"
          />
        </div>

        {/* View Tabs Bar */}
        <div className={styles.viewTabsBar}>
          <div className={styles.viewTabs}>
            {dbViews.map((view) => (
              <button
                key={view.id}
                className={`${styles.viewTab} ${view.id === activeViewId ? styles.viewTabActive : ""}`}
                onClick={() => setActiveView(block.id, view.id)}
              >
                {view.layout === "table" && <Table2 size={14} />}
                {view.layout === "board" && <Kanban size={14} />}
                {view.layout === "calendar" && <Calendar size={14} />}
                {view.layout === "list" && <ListIcon size={14} />}
                <span>{view.name}</span>
              </button>
            ))}
          </div>

          <div className={styles.viewActions}>
            <div className={styles.searchBox}>
              <Search size={13} />
              <input
                className={styles.searchInput}
                placeholder="Search rows..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
            <button
              className={styles.newBtn}
              onClick={() => {
                const newRow = createDatabaseRow(block.id, "New entry");
                setSidePeekBlock(newRow.id);
              }}
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>
        </div>
      </div>

      {/* View Content (Table or Board) */}
      <div className={styles.contentArea}>
        {(!currentView || currentView.layout === "table") && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thMain}>Name</th>
                  {statusProp && <th className={styles.th}>Status</th>}
                  {priorityProp && <th className={styles.th}>Priority</th>}
                  <th className={styles.th}>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={styles.tr}
                    onContextMenu={(e) => openContextMenu(row.id, e)}
                  >
                    <td
                      className={styles.tdMain}
                      onClick={() => setSidePeekBlock(row.id)}
                    >
                      <span className={styles.rowIcon}>{row.icon || "📄"}</span>
                      <input
                        className={styles.inlineTitleInput}
                        value={row.title || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          updateRowProperty(row.id, "prop-title", e.target.value);
                        }}
                        placeholder="Untitled"
                      />
                      <button
                        className={styles.openPeekBtn}
                        title="Open in Side Peek"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSidePeekBlock(row.id);
                        }}
                      >
                        <ExternalLink size={12} />
                        <span>OPEN</span>
                      </button>
                    </td>

                    {statusProp && (
                      <td className={styles.td}>
                        <select
                          className={styles.cellSelect}
                          value={(row.properties?.[statusProp.id] as string) || ""}
                          onChange={(e) =>
                            updateRowProperty(row.id, statusProp.id, e.target.value)
                          }
                        >
                          <option value="">Empty</option>
                          {statusProp.options?.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                        <div className={styles.pillDisplay}>
                          {renderStatusPill(row.properties?.[statusProp.id])}
                        </div>
                      </td>
                    )}

                    {priorityProp && (
                      <td className={styles.td}>
                        <select
                          className={styles.cellSelect}
                          value={(row.properties?.[priorityProp.id] as string) || ""}
                          onChange={(e) =>
                            updateRowProperty(row.id, priorityProp.id, e.target.value)
                          }
                        >
                          <option value="">-</option>
                          {priorityProp.options?.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                        <div className={styles.pillDisplay}>
                          {renderPriorityPill(row.properties?.[priorityProp.id])}
                        </div>
                      </td>
                    )}

                    <td className={styles.td}>
                      <input
                        type="date"
                        className={styles.inlineDateInput}
                        value={(row.properties?.["prop-due"] as string) || ""}
                        onChange={(e) =>
                          updateRowProperty(row.id, "prop-due", e.target.value)
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Quick add row button at bottom of table */}
            <button
              className={styles.addBottomRowBtn}
              onClick={() => createDatabaseRow(block.id, "New entry")}
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>
        )}

        {currentView?.layout === "board" && (
          <div className={styles.boardWrapper}>
            {statusProp?.options?.map((column) => {
              const columnRows = filteredRows.filter(
                (r) => (r.properties?.[statusProp.id] as string) === column.id
              );
              return (
                <div key={column.id} className={styles.boardColumn}>
                  <div className={styles.columnHeader}>
                    <span
                      className={`${styles.pill} ${styles[`pill_${column.color || "default"}`]}`}
                    >
                      {column.name}
                    </span>
                    <span className={styles.columnCount}>{columnRows.length}</span>
                  </div>

                  <div className={styles.cardList}>
                    {columnRows.map((card) => (
                      <div
                        key={card.id}
                        className={styles.boardCard}
                        onClick={() => setSidePeekBlock(card.id)}
                        onContextMenu={(e) => openContextMenu(card.id, e)}
                      >
                        <div className={styles.cardTitleRow}>
                          <span className={styles.cardIcon}>{card.icon || "📄"}</span>
                          <span className={styles.cardTitle}>{card.title || "Untitled"}</span>
                        </div>

                        {/* Interactive Board Card Badges / Controls */}
                        <div className={styles.cardBadges} onClick={(e) => e.stopPropagation()}>
                          {priorityProp && (
                            <div className={styles.badgeWrapper}>
                              <select
                                className={styles.cardSelect}
                                value={(card.properties?.[priorityProp.id] as string) || ""}
                                onChange={(e) =>
                                  updateRowProperty(card.id, priorityProp.id, e.target.value)
                                }
                              >
                                <option value="">No priority</option>
                                {priorityProp.options?.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.name}
                                  </option>
                                ))}
                              </select>
                              <div className={styles.pillDisplay}>
                                {renderPriorityPill(card.properties?.[priorityProp.id])}
                              </div>
                            </div>
                          )}

                          {card.properties?.["prop-due"] ? (
                            <span className={styles.cardDate}>
                              {String(card.properties["prop-due"])}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    className={styles.addCardBtn}
                    onClick={() => {
                      const initialProps: Record<string, unknown> = {};
                      if (statusProp) {
                        initialProps[statusProp.id] = column.id;
                      }
                      const newRow = createDatabaseRow(block.id, "New task", initialProps);
                      setSidePeekBlock(newRow.id);
                    }}
                  >
                    <Plus size={13} />
                    <span>New</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Context Menu for Board Cards and Table Rows */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.floatingContextMenu}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              setSidePeekBlock(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <ExternalLink size={13} />
            <span>Open in Side Peek</span>
          </button>
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              setActiveBlock(contextMenu.rowId);
              setSidePeekBlock(null);
              setContextMenu(null);
            }}
          >
            <Maximize2 size={13} />
            <span>Open as Page</span>
          </button>

          {statusProp && (
            <div className={styles.contextSubSection}>
              <div className={styles.contextSubHeader}>Move status to:</div>
              {statusProp.options?.map((opt) => (
                <button
                  key={opt.id}
                  className={styles.contextMenuItem}
                  onClick={() => {
                    updateRowProperty(contextMenu.rowId, statusProp.id, opt.id);
                    setContextMenu(null);
                  }}
                >
                  <ArrowRight size={13} />
                  <span>{opt.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.contextDivider} />

          <button
            className={styles.contextMenuItem}
            onClick={() => {
              duplicateBlock(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Duplicate</span>
          </button>
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={() => {
              archiveBlock(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}
