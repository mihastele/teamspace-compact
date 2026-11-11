"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block, DatabaseProperty, PropertyType, ViewLayout } from "@/lib/model";
import {
  Table2,
  Kanban,
  Calendar as CalendarIcon,
  List as ListIcon,
  Plus,
  Search,
  ExternalLink,
  Copy,
  Trash2,
  Maximize2,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  X,
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
    createDatabaseView,
    deleteDatabaseView,
    createDatabaseProperty,
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

  // Popover states
  const [showAddViewMenu, setShowAddViewMenu] = useState(false);
  const [showAddPropMenu, setShowAddPropMenu] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const addViewRef = useRef<HTMLDivElement>(null);
  const addPropRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
      if (
        addViewRef.current &&
        !addViewRef.current.contains(e.target as Node)
      ) {
        setShowAddViewMenu(false);
      }
      if (
        addPropRef.current &&
        !addPropRef.current.contains(e.target as Node)
      ) {
        setShowAddPropMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setShowAddViewMenu(false);
        setShowAddPropMenu(false);
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

  const renderGenericPill = (prop: DatabaseProperty, val: unknown) => {
    const opt = prop.options?.find((o) => o.id === val);
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

  // Calendar calculations
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const calendarDays: {
    dayNumber: number;
    isCurrentMonth: boolean;
    dateString: string;
  }[] = [];

  // Previous month trailing days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevMonth = month === 0 ? 12 : month;
    const prevYear = month === 0 ? year - 1 : year;
    const dateString = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({
      dayNumber: d,
      isCurrentMonth: false,
      dateString,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({
      dayNumber: d,
      isCurrentMonth: true,
      dateString,
    });
  }

  // Next month leading days to complete grid (up to multiple of 7)
  const remaining = (7 - (calendarDays.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 1 : month + 2;
    const nextYear = month === 11 ? year + 1 : year;
    const dateString = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({
      dayNumber: d,
      isCurrentMonth: false,
      dateString,
    });
  }

  const todayString = new Date().toISOString().slice(0, 10);
  const monthName = calendarDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  // Additional dynamic properties beyond title
  const dynamicProps = dbProperties.filter((p) => p.type !== "title" && p.id !== "prop-title");

  const handleAddView = (layout: ViewLayout) => {
    createDatabaseView(block.id, layout);
    setShowAddViewMenu(false);
  };

  const handleAddProperty = () => {
    if (!newPropName.trim()) return;
    createDatabaseProperty(block.id, newPropName.trim(), newPropType);
    setNewPropName("");
    setNewPropType("text");
    setShowAddPropMenu(false);
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
                {view.layout === "calendar" && <CalendarIcon size={14} />}
                {view.layout === "list" && <ListIcon size={14} />}
                <span>{view.name}</span>
                {dbViews.length > 1 && (
                  <span
                    className={styles.deleteViewBtn}
                    title="Delete view"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDatabaseView(block.id, view.id);
                    }}
                  >
                    <X size={12} />
                  </span>
                )}
              </button>
            ))}

            {/* Add View Button & Popover */}
            <div style={{ position: "relative" }} ref={addViewRef}>
              <button
                className={styles.addViewBtn}
                title="Add view"
                onClick={() => setShowAddViewMenu((prev) => !prev)}
              >
                <Plus size={14} />
              </button>

              {showAddViewMenu && (
                <div className={styles.viewPopover}>
                  <div className={styles.popoverHeader}>New View Layout</div>
                  <button
                    className={styles.popoverItem}
                    onClick={() => handleAddView("table")}
                  >
                    <Table2 size={14} />
                    <span>Table</span>
                  </button>
                  <button
                    className={styles.popoverItem}
                    onClick={() => handleAddView("board")}
                  >
                    <Kanban size={14} />
                    <span>Board</span>
                  </button>
                  <button
                    className={styles.popoverItem}
                    onClick={() => handleAddView("list")}
                  >
                    <ListIcon size={14} />
                    <span>List</span>
                  </button>
                  <button
                    className={styles.popoverItem}
                    onClick={() => handleAddView("calendar")}
                  >
                    <CalendarIcon size={14} />
                    <span>Calendar</span>
                  </button>
                </div>
              )}
            </div>
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

      {/* View Content (Table, Board, List, or Calendar) */}
      <div className={styles.contentArea}>
        {/* TABLE VIEW */}
        {(!currentView || currentView.layout === "table") && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thMain}>Name</th>
                  {dynamicProps.map((prop) => (
                    <th key={prop.id} className={styles.th}>
                      {prop.name}
                    </th>
                  ))}
                  {/* Add Property Column Header */}
                  <th className={styles.thAddProp} ref={addPropRef}>
                    <button
                      className={styles.addPropBtn}
                      title="Add property"
                      onClick={() => setShowAddPropMenu((prev) => !prev)}
                    >
                      <Plus size={14} />
                    </button>
                    {showAddPropMenu && (
                      <div className={styles.propPopover}>
                        <div className={styles.popoverHeader}>New Property</div>
                        <input
                          className={styles.propInput}
                          placeholder="Property name"
                          value={newPropName}
                          onChange={(e) => setNewPropName(e.target.value)}
                          autoFocus
                        />
                        <select
                          className={styles.propSelect}
                          value={newPropType}
                          onChange={(e) =>
                            setNewPropType(e.target.value as PropertyType)
                          }
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="select">Select</option>
                          <option value="status">Status</option>
                          <option value="date">Date</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="email">Email</option>
                          <option value="url">URL</option>
                        </select>
                        <button
                          className={styles.createPropBtn}
                          onClick={handleAddProperty}
                        >
                          Create Property
                        </button>
                      </div>
                    )}
                  </th>
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

                    {/* Dynamic Property Cells */}
                    {dynamicProps.map((prop) => {
                      const val = row.properties?.[prop.id];

                      if (prop.type === "status") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <select
                              className={styles.cellSelect}
                              value={(val as string) || ""}
                              onChange={(e) =>
                                updateRowProperty(row.id, prop.id, e.target.value)
                              }
                            >
                              <option value="">Empty</option>
                              {prop.options?.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name}
                                </option>
                              ))}
                            </select>
                            <div className={styles.pillDisplay}>
                              {renderStatusPill(val)}
                            </div>
                          </td>
                        );
                      }

                      if (prop.type === "select" || prop.id === "prop-priority") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <select
                              className={styles.cellSelect}
                              value={(val as string) || ""}
                              onChange={(e) =>
                                updateRowProperty(row.id, prop.id, e.target.value)
                              }
                            >
                              <option value="">-</option>
                              {prop.options?.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name}
                                </option>
                              ))}
                            </select>
                            <div className={styles.pillDisplay}>
                              {prop.id === "prop-priority"
                                ? renderPriorityPill(val)
                                : renderGenericPill(prop, val)}
                            </div>
                          </td>
                        );
                      }

                      if (prop.type === "date" || prop.id === "prop-due") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <input
                              type="date"
                              className={styles.inlineDateInput}
                              value={(val as string) || ""}
                              onChange={(e) =>
                                updateRowProperty(row.id, prop.id, e.target.value)
                              }
                            />
                          </td>
                        );
                      }

                      if (prop.type === "checkbox") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <input
                              type="checkbox"
                              className={styles.checkboxInput}
                              checked={Boolean(val)}
                              onChange={(e) =>
                                updateRowProperty(row.id, prop.id, e.target.checked)
                              }
                            />
                          </td>
                        );
                      }

                      if (prop.type === "number") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <input
                              type="number"
                              className={styles.inlineTextInput}
                              value={(val as number) ?? ""}
                              onChange={(e) =>
                                updateRowProperty(
                                  row.id,
                                  prop.id,
                                  e.target.value ? Number(e.target.value) : null
                                )
                              }
                              placeholder="Empty"
                            />
                          </td>
                        );
                      }

                      // Default text / url / email
                      return (
                        <td key={prop.id} className={styles.td}>
                          <input
                            type="text"
                            className={styles.inlineTextInput}
                            value={(val as string) || ""}
                            onChange={(e) =>
                              updateRowProperty(row.id, prop.id, e.target.value)
                            }
                            placeholder="Empty"
                          />
                        </td>
                      );
                    })}

                    <td className={styles.td} />
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

        {/* BOARD VIEW */}
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

        {/* LIST VIEW */}
        {currentView?.layout === "list" && (
          <div className={styles.listWrapper}>
            {filteredRows.map((row) => (
              <div
                key={row.id}
                className={styles.listItem}
                onClick={() => setSidePeekBlock(row.id)}
                onContextMenu={(e) => openContextMenu(row.id, e)}
              >
                <div className={styles.listItemMain}>
                  <span className={styles.rowIcon}>{row.icon || "📄"}</span>
                  <input
                    className={styles.listItemTitle}
                    value={row.title || ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateRowProperty(row.id, "prop-title", e.target.value)
                    }
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
                </div>

                <div
                  className={styles.listItemProps}
                  onClick={(e) => e.stopPropagation()}
                >
                  {statusProp && (
                    <div className={styles.badgeWrapper}>
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
                    </div>
                  )}

                  {priorityProp && (
                    <div className={styles.badgeWrapper}>
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
                    </div>
                  )}

                  {row.properties?.["prop-due"] ? (
                    <span className={styles.cardDate}>
                      {String(row.properties["prop-due"])}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}

            <button
              className={styles.addBottomRowBtn}
              onClick={() => {
                const newRow = createDatabaseRow(block.id, "New entry");
                setSidePeekBlock(newRow.id);
              }}
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>
        )}

        {/* CALENDAR VIEW */}
        {currentView?.layout === "calendar" && (
          <div className={styles.calendarWrapper}>
            <div className={styles.calendarControls}>
              <span className={styles.calendarMonthTitle}>{monthName}</span>
              <div className={styles.calendarNavGroup}>
                <button
                  className={styles.calendarNavBtn}
                  onClick={() =>
                    setCalendarDate(new Date(year, month - 1, 1))
                  }
                  title="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  className={styles.calendarNavBtn}
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </button>
                <button
                  className={styles.calendarNavBtn}
                  onClick={() =>
                    setCalendarDate(new Date(year, month + 1, 1))
                  }
                  title="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className={styles.calendarGrid}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (day) => (
                  <div key={day} className={styles.calendarDayHeader}>
                    {day}
                  </div>
                )
              )}

              {calendarDays.map((cell, idx) => {
                const cellRows = filteredRows.filter(
                  (r) =>
                    r.properties?.["prop-due"] === cell.dateString ||
                    r.properties?.["date"] === cell.dateString
                );
                const isToday = cell.dateString === todayString;

                return (
                  <div
                    key={idx}
                    className={`${styles.calendarDayCell} ${!cell.isCurrentMonth ? styles.calendarDayCellOtherMonth : ""}`}
                  >
                    <div className={styles.calendarDayTopRow}>
                      <span
                        className={`${styles.calendarDayNumber} ${isToday ? styles.calendarDayToday : ""}`}
                      >
                        {cell.dayNumber}
                      </span>
                      <button
                        className={styles.calendarAddBtn}
                        title={`Add task on ${cell.dateString}`}
                        onClick={() => {
                          const newRow = createDatabaseRow(
                            block.id,
                            "New entry",
                            { "prop-due": cell.dateString }
                          );
                          setSidePeekBlock(newRow.id);
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className={styles.calendarEventsList}>
                      {cellRows.map((item) => (
                        <div
                          key={item.id}
                          className={styles.calendarEventItem}
                          onClick={() => setSidePeekBlock(item.id)}
                          onContextMenu={(e) => openContextMenu(item.id, e)}
                          title={item.title || "Untitled"}
                        >
                          <span>{item.icon || "📄"}</span>
                          <span>{item.title || "Untitled"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
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
