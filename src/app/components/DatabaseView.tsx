"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type {
  Block,
  DatabaseProperty,
  PropertyType,
  ViewLayout,
  ViewFilterRule,
  CalculationType,
} from "@/lib/model";
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
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  RotateCcw,
  Edit2,
  ArrowLeft,
  LayoutTemplate,
} from "lucide-react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DragProvider, DragItem, DropZone } from "./DragItem";
import { contextMenuProps, type ContextMenuItem } from "./ContextMenu";
import DatabaseTemplatesModal from "./DatabaseTemplatesModal";
import styles from "./DatabaseView.module.css";

export type DatabaseViewProps = {
  block: Block;
  embedded?: boolean;
  readOnly?: boolean;
  initialViewId?: string;
  overrideFilters?: ViewFilterRule[];
  currentPageId?: string;
  onOverrideFiltersChange?: (rules: ViewFilterRule[]) => void;
};

export default function DatabaseView({
  block,
  embedded = false,
  readOnly = false,
  initialViewId,
  overrideFilters,
  currentPageId,
  onOverrideFiltersChange,
}: DatabaseViewProps) {
  const {
    blocks,
    childrenIndex,
    properties,
    views,
    templates,
    activeViewIdByDatabase,
    setActiveView,
    createDatabaseRow,
    updateRowProperty,
    createDatabaseView,
    updateDatabaseView,
    deleteDatabaseView,
    moveDatabaseView,
    moveBlockWithinParent,
    createDatabaseProperty,
    updateDatabaseProperty,
    deleteDatabaseProperty,
    restoreDatabaseProperty,
    setSidePeekBlock,
    setActiveBlock,
    updateBlock,
    duplicateBlock,
    archiveBlock,
  } = useWorkspace();

  const rawProperties = properties[block.id];
  const dbProperties = useMemo(() => rawProperties || [], [rawProperties]);
  const dbViews = views[block.id] || [];
  const dbTemplates = templates?.[block.id] || [];
  const [localViewId, setLocalViewId] = useState<string | undefined>(initialViewId);
  const activeViewId = embedded
    ? localViewId || dbViews[0]?.id
    : (activeViewIdByDatabase && activeViewIdByDatabase[block.id]) || dbViews[0]?.id;
  const currentView = dbViews.find((v) => v.id === activeViewId) || dbViews[0];
  const allDatabases = useMemo(
    () => Object.values(blocks).filter((b) => b.type === "database" && !b.isArchived),
    [blocks]
  );

  const rowIds = ((childrenIndex && childrenIndex[block.id]) || []).filter(
    (id) => !blocks[id]?.isArchived
  );
  const rows = rowIds.map((id) => blocks[id]).filter(Boolean);

  const [searchFilter, setSearchFilter] = useState("");
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [showSortPopover, setShowSortPopover] = useState(false);
  const [showPropsPopover, setShowPropsPopover] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameViewValue, setRenameViewValue] = useState("");

  // Popover states
  const [showAddViewMenu, setShowAddViewMenu] = useState(false);
  const [showAddPropMenu, setShowAddPropMenu] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");
  const [newPropTargetDb, setNewPropTargetDb] = useState<string>("__any__");
  const [newGroupOptionName, setNewGroupOptionName] = useState("");
  const [showAddGroupPopover, setShowAddGroupPopover] = useState(false);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  const addViewRef = useRef<HTMLDivElement>(null);
  const addPropRef = useRef<HTMLTableCellElement>(null);
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const propsPopoverRef = useRef<HTMLDivElement>(null);
  const addGroupPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (addViewRef.current && !addViewRef.current.contains(target)) {
        setShowAddViewMenu(false);
      }
      if (addPropRef.current && !addPropRef.current.contains(target)) {
        setShowAddPropMenu(false);
      }
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(target)) {
        setShowSortPopover(false);
      }
      if (propsPopoverRef.current && !propsPopoverRef.current.contains(target)) {
        setShowPropsPopover(false);
      }
      if (addGroupPopoverRef.current && !addGroupPopoverRef.current.contains(target)) {
        setShowAddGroupPopover(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAddViewMenu(false);
        setShowAddPropMenu(false);
        setShowSortPopover(false);
        setShowPropsPopover(false);
        setShowAddGroupPopover(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const statusProp = dbProperties.find((p) => p.type === "status" || p.id === "prop-status");
  const priorityProp = dbProperties.find((p) => p.id === "prop-priority");

  const selectView = (viewId: string) => {
    if (embedded) {
      setLocalViewId(viewId);
    } else {
      setActiveView(block.id, viewId);
    }
  };

  const activeFilterRules = useMemo(
    () => (overrideFilters !== undefined ? overrideFilters : currentView?.filter?.rules || []),
    [overrideFilters, currentView]
  );

  const updateActiveFilterRules = (nextRules: ViewFilterRule[], nextOp?: "and" | "or") => {
    if (onOverrideFiltersChange) {
      onOverrideFiltersChange(nextRules);
    } else if (currentView) {
      updateDatabaseView(block.id, currentView.id, {
        filter: {
          operator: nextOp || currentView.filter?.operator || "and",
          rules: nextRules,
        },
      });
    }
  };

  // Filter & Sort Engine
  const processedRows = useMemo(() => {
    // 1. Filter by Quick Search
    let result = rows.filter((row) =>
      (row.title || "").toLowerCase().includes(searchFilter.toLowerCase())
    );

    // 2. Filter by View / Override Filter Rules
    if (activeFilterRules.length > 0) {
      const operator = currentView?.filter?.operator || "and";
      const todayStr = new Date().toISOString().slice(0, 10);
      result = result.filter((row) => {
        const matches = activeFilterRules.map((rule) => {
          const propDef = dbProperties.find((p) => p.id === rule.propertyId);
          // If property is a deleted core property, its effective value is null
          const rawVal = propDef?.isDeleted
            ? null
            : rule.propertyId === "prop-title"
              ? row.title
              : row.properties?.[rule.propertyId];

          const resolvedRuleVal =
            rule.value === "$this"
              ? (currentPageId || "")
              : rule.value === "$today"
                ? todayStr
                : rule.value;

          switch (rule.operator) {
            case "is_empty":
              return rawVal === undefined || rawVal === null || rawVal === "" || (Array.isArray(rawVal) && rawVal.length === 0);
            case "is_not_empty":
              return rawVal !== undefined && rawVal !== null && rawVal !== "" && !(Array.isArray(rawVal) && rawVal.length === 0);
            case "equals":
              if (Array.isArray(rawVal)) {
                return rawVal.map(String).includes(String(resolvedRuleVal ?? ""));
              }
              return String(rawVal ?? "") === String(resolvedRuleVal ?? "");
            case "does_not_equal":
              if (Array.isArray(rawVal)) {
                return !rawVal.map(String).includes(String(resolvedRuleVal ?? ""));
              }
              return String(rawVal ?? "") !== String(resolvedRuleVal ?? "");
            case "contains":
              if (Array.isArray(rawVal)) {
                return rawVal.map(String).includes(String(resolvedRuleVal ?? ""));
              }
              return String(rawVal ?? "").toLowerCase().includes(String(resolvedRuleVal ?? "").toLowerCase());
            case "does_not_contain":
              if (Array.isArray(rawVal)) {
                return !rawVal.map(String).includes(String(resolvedRuleVal ?? ""));
              }
              return !String(rawVal ?? "").toLowerCase().includes(String(resolvedRuleVal ?? "").toLowerCase());
            case "greater_than":
              return Number(rawVal) > Number(resolvedRuleVal);
            case "less_than":
              return Number(rawVal) < Number(resolvedRuleVal);
            case "is_today": {
              return rawVal === todayStr;
            }
            case "is_overdue": {
              return typeof rawVal === "string" && rawVal !== "" && rawVal < todayStr;
            }
            case "next_7_days": {
              const today = new Date();
              const nextWeek = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
              return typeof rawVal === "string" && rawVal >= todayStr && rawVal <= nextWeek;
            }
            default:
              return true;
          }
        });

        return operator === "or" ? matches.some(Boolean) : matches.every(Boolean);
      });
    }

    // 3. Sort by View Sorts
    if (currentView?.sorts && currentView.sorts.length > 0) {
      result = [...result].sort((a, b) => {
        for (const sort of currentView.sorts!) {
          const propDef = dbProperties.find((p) => p.id === sort.propertyId);
          let valA: unknown = sort.propertyId === "prop-title" ? a.title : a.properties?.[sort.propertyId];
          let valB: unknown = sort.propertyId === "prop-title" ? b.title : b.properties?.[sort.propertyId];

          if (propDef?.isDeleted) {
            valA = null;
            valB = null;
          }

          // Empty values sort last in both directions
          const aEmpty = valA === undefined || valA === null || valA === "";
          const bEmpty = valB === undefined || valB === null || valB === "";
          if (aEmpty && !bEmpty) return 1;
          if (!aEmpty && bEmpty) return -1;
          if (aEmpty && bEmpty) continue;

          let cmp = 0;
          if (typeof valA === "number" && typeof valB === "number") {
            cmp = valA - valB;
          } else {
            cmp = String(valA).localeCompare(String(valB));
          }

          if (cmp !== 0) {
            return sort.direction === "desc" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    return result;
  }, [rows, searchFilter, activeFilterRules, currentView, dbProperties, currentPageId]);

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

  // ---------- Context menu definitions (each element type owns its menu) ----------
  const setColumnSort = (propertyId: string, direction: "asc" | "desc" | null) => {
    if (!currentView) return;
    const rest = (currentView.sorts || []).filter((s) => s.propertyId !== propertyId);
    updateDatabaseView(block.id, currentView.id, {
      sorts: direction ? [{ propertyId, direction }, ...rest] : rest,
    });
  };

  const rowMenu = (rowId: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { id: "peek", label: "Open in Side Peek", icon: <ExternalLink size={13} />, onSelect: () => setSidePeekBlock(rowId) },
      {
        id: "page",
        label: "Open as Page",
        icon: <Maximize2 size={13} />,
        onSelect: () => {
          setActiveBlock(rowId);
          setSidePeekBlock(null);
        },
      },
    ];
    if (statusProp && !statusProp.isDeleted && statusProp.options?.length) {
      items.push({ type: "separator", id: "s-status" }, { type: "header", id: "h-status", label: "Move status to" });
      statusProp.options.forEach((opt) =>
        items.push({
          id: `status-${opt.id}`,
          label: opt.name,
          icon: <ArrowRight size={13} />,
          onSelect: () => updateRowProperty(rowId, statusProp.id, opt.id),
        })
      );
    }
    if (priorityProp && !priorityProp.isDeleted && priorityProp.options?.length) {
      items.push({ type: "separator", id: "s-prio" }, { type: "header", id: "h-prio", label: "Set priority" });
      [...priorityProp.options, { id: "", name: "No priority" }].forEach((opt) =>
        items.push({
          id: `prio-${opt.id || "none"}`,
          label: opt.name,
          icon: <ArrowRight size={13} />,
          onSelect: () => updateRowProperty(rowId, priorityProp.id, opt.id || null),
        })
      );
    }
    items.push(
      { type: "separator", id: "s-end" },
      { id: "dup", label: "Duplicate", icon: <Copy size={13} />, onSelect: () => duplicateBlock(rowId) },
      { id: "del", label: "Delete", icon: <Trash2 size={13} />, danger: true, onSelect: () => archiveBlock(rowId) }
    );
    return items;
  };

  const viewMenu = (viewId: string): ContextMenuItem[] => {
    const idx = dbViews.findIndex((v) => v.id === viewId);
    const view = dbViews[idx];
    if (!view) return [];
    return [
      {
        id: "rename",
        label: "Rename view",
        icon: <Edit2 size={13} />,
        onSelect: () => {
          setRenamingViewId(viewId);
          setRenameViewValue(view.name);
        },
      },
      {
        id: "left",
        label: "Move left",
        icon: <ArrowLeft size={13} />,
        disabled: idx <= 0,
        onSelect: () => moveDatabaseView(block.id, viewId, dbViews[idx - 1].id),
      },
      {
        id: "right",
        label: "Move right",
        icon: <ArrowRight size={13} />,
        disabled: idx >= dbViews.length - 1,
        onSelect: () => moveDatabaseView(block.id, viewId, dbViews[idx + 1].id),
      },
      { type: "separator", id: "s1" },
      {
        id: "clear-sort",
        label: "Remove sort",
        icon: <ArrowUpDown size={13} />,
        disabled: !view.sorts?.length,
        onSelect: () => updateDatabaseView(block.id, viewId, { sorts: [] }),
      },
      {
        id: "delete",
        label: "Delete view",
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: dbViews.length <= 1,
        onSelect: () => deleteDatabaseView(block.id, viewId),
      },
    ];
  };

  const columnMenu = (propertyId: string): ContextMenuItem[] => {
    const prop = dbProperties.find((p) => p.id === propertyId);
    const sorted = currentView?.sorts?.find((s) => s.propertyId === propertyId);
    const items: ContextMenuItem[] = [
      {
        id: "asc",
        label: "Sort ascending",
        icon: <ArrowUp size={13} />,
        disabled: sorted?.direction === "asc",
        onSelect: () => setColumnSort(propertyId, "asc"),
      },
      {
        id: "desc",
        label: "Sort descending",
        icon: <ArrowDown size={13} />,
        disabled: sorted?.direction === "desc",
        onSelect: () => setColumnSort(propertyId, "desc"),
      },
      {
        id: "nosort",
        label: "Remove sort",
        icon: <X size={13} />,
        disabled: !sorted,
        onSelect: () => setColumnSort(propertyId, null),
      },
    ];
    if (prop && propertyId !== "prop-title") {
      items.push({ type: "separator", id: "s1" });
      items.push(
        prop.isDeleted
          ? { id: "restore", label: "Restore property", icon: <RotateCcw size={13} />, onSelect: () => restoreDatabaseProperty(block.id, propertyId) }
          : { id: "delprop", label: "Delete property", icon: <Trash2 size={13} />, danger: true, onSelect: () => deleteDatabaseProperty(block.id, propertyId) }
      );
    }
    return items;
  };

  const newEntryMenu = (label: string, initial: Record<string, unknown>): ContextMenuItem[] => [
    {
      id: "new",
      label,
      icon: <Plus size={13} />,
      onSelect: () => {
        const row = createDatabaseRow(block.id, "New entry", initial);
        setSidePeekBlock(row.id);
      },
    },
  ];

  // ---------- Drag & drop (views, rows, board columns, calendar days) ----------
  const groupPropId = statusProp?.id || "prop-status";

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;

    if (a.startsWith("view:") && o.startsWith("view:")) {
      moveDatabaseView(block.id, a.slice(5), o.slice(5));
      return;
    }
    if (!a.startsWith("row:")) return;
    const rowId = a.slice(4);

    if (o.startsWith("row:")) {
      const targetId = o.slice(4);
      if (currentView?.layout === "board") {
        const targetVal = blocks[targetId]?.properties?.[groupPropId] ?? null;
        const curVal = blocks[rowId]?.properties?.[groupPropId] ?? null;
        if (targetVal !== curVal) updateRowProperty(rowId, groupPropId, targetVal);
      }
      if (currentView?.layout === "calendar") {
        const targetDue = blocks[targetId]?.properties?.["prop-due"] ?? null;
        if (targetDue !== (blocks[rowId]?.properties?.["prop-due"] ?? null)) {
          updateRowProperty(rowId, "prop-due", targetDue);
        }
      }
      moveBlockWithinParent(block.id, rowId, targetId);
      // A manual order only becomes visible when no sort overrides it.
      if (currentView && currentView.layout !== "board" && currentView.sorts?.length) {
        updateDatabaseView(block.id, currentView.id, { sorts: [] });
      }
    } else if (o.startsWith("col:")) {
      const colId = o.slice(4);
      updateRowProperty(rowId, groupPropId, colId === "__null__" ? null : colId);
    } else if (o.startsWith("day:")) {
      updateRowProperty(rowId, "prop-due", o.slice(4));
    }
  };

  // Toggle sort for a specific column header
  const handleToggleColumnSort = (propertyId: string) => {
    if (!currentView) return;
    const existingSorts = currentView.sorts || [];
    const currentSort = existingSorts.find((s) => s.propertyId === propertyId);

    let nextSorts = existingSorts.filter((s) => s.propertyId !== propertyId);
    if (!currentSort) {
      nextSorts = [{ propertyId, direction: "asc" }, ...nextSorts];
    } else if (currentSort.direction === "asc") {
      nextSorts = [{ propertyId, direction: "desc" }, ...nextSorts];
    }
    // If was desc, removal from nextSorts means reset to none

    updateDatabaseView(block.id, currentView.id, { sorts: nextSorts });
  };

  // Calculations for Table Footer
  const calculateMetric = (propId: string, type: CalculationType): string | number => {
    if (!type || type === "none") return "";
    const vals = processedRows.map((r) => r.properties?.[propId]);
    const nonEmpty = vals.filter((v) => v !== undefined && v !== null && v !== "");

    switch (type) {
      case "count_all":
        return `Count ${processedRows.length}`;
      case "count_values":
        return `Values ${nonEmpty.length}`;
      case "count_empty":
        return `Empty ${processedRows.length - nonEmpty.length}`;
      case "percent_empty":
        return `${Math.round(((processedRows.length - nonEmpty.length) / (processedRows.length || 1)) * 100)}%`;
      case "percent_not_empty":
        return `${Math.round((nonEmpty.length / (processedRows.length || 1)) * 100)}%`;
      case "sum": {
        const sum = (nonEmpty as unknown[]).reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
        return `Sum ${sum}`;
      }
      case "average": {
        const sum = (nonEmpty as unknown[]).reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
        return `Avg ${nonEmpty.length ? (sum / nonEmpty.length).toFixed(1) : 0}`;
      }
      case "min": {
        const nums = nonEmpty.map(Number).filter((n) => !isNaN(n));
        return nums.length ? `Min ${Math.min(...nums)}` : "";
      }
      case "max": {
        const nums = nonEmpty.map(Number).filter((n) => !isNaN(n));
        return nums.length ? `Max ${Math.max(...nums)}` : "";
      }
      default:
        return "";
    }
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

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevMonth = month === 0 ? 12 : month;
    const prevYear = month === 0 ? year - 1 : year;
    const dateString = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({ dayNumber: d, isCurrentMonth: false, dateString });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({ dayNumber: d, isCurrentMonth: true, dateString });
  }

  const remaining = (7 - (calendarDays.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 1 : month + 2;
    const nextYear = month === 11 ? year + 1 : year;
    const dateString = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendarDays.push({ dayNumber: d, isCurrentMonth: false, dateString });
  }

  const todayString = new Date().toISOString().slice(0, 10);
  const monthName = calendarDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const dynamicProps = dbProperties.filter((p) => p.type !== "title" && p.id !== "prop-title");
  const sortableProps: DatabaseProperty[] = [
    dbProperties.find((p) => p.id === "prop-title") ||
      ({ id: "prop-title", name: "Name", type: "title", position: "a0" } as DatabaseProperty),
    ...dynamicProps.filter((p) => !p.isDeleted),
  ];

  const handleAddView = (layout: ViewLayout) => {
    createDatabaseView(block.id, layout);
    setShowAddViewMenu(false);
  };

  const handleAddProperty = () => {
    if (!newPropName.trim()) return;
    createDatabaseProperty(
      block.id,
      newPropName.trim(),
      newPropType,
      undefined,
      newPropType === "relation" ? newPropTargetDb : undefined
    );
    setNewPropName("");
    setNewPropType("text");
    setShowAddPropMenu(false);
  };

  return (
    <DragProvider onEnd={handleDragEnd}>
    <div className={styles.databaseContainer} style={embedded ? { padding: "8px 12px" } : undefined}>
      {/* Database Title & Header */}
      <div className={styles.header}>
        {!embedded && (
          <div className={styles.titleRow}>
            <span className={styles.icon}>{block.icon || "🗂️"}</span>
            <input
              className={styles.titleInput}
              value={block.title}
              readOnly={readOnly}
              onChange={(e) => {
                if (!readOnly) updateBlock(block.id, { title: e.target.value });
              }}
              placeholder="Untitled Database"
            />
          </div>
        )}

        {/* View Tabs Bar */}
        <div className={styles.viewTabsBar}>
          <div className={styles.viewTabs}>
            {dbViews.map((view) => (
              <DragItem
                key={view.id}
                id={`view:${view.id}`}
                as="div"
                role="tab"
                aria-selected={view.id === activeViewId}
                tabIndex={0}
                className={`${styles.viewTab} ${view.id === activeViewId ? styles.viewTabActive : ""}`}
                draggingClassName={styles.dragging}
                overClassName={styles.dropTarget}
                onClick={() => selectView(view.id)}
                onDoubleClick={() => {
                  if (readOnly) return;
                  setRenamingViewId(view.id);
                  setRenameViewValue(view.name);
                }}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    selectView(view.id);
                  }
                }}
                {...contextMenuProps(() => viewMenu(view.id))}
              >
                {view.layout === "table" && <Table2 size={14} />}
                {view.layout === "board" && <Kanban size={14} />}
                {view.layout === "calendar" && <CalendarIcon size={14} />}
                {view.layout === "list" && <ListIcon size={14} />}
                {renamingViewId === view.id ? (
                  <input
                    autoFocus
                    className={styles.propInput}
                    style={{ width: 110, margin: 0, padding: "1px 4px" }}
                    value={renameViewValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameViewValue(e.target.value)}
                    onBlur={() => {
                      updateDatabaseView(block.id, view.id, { name: renameViewValue.trim() || view.name });
                      setRenamingViewId(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenamingViewId(null);
                    }}
                  />
                ) : (
                  <span>{view.name}</span>
                )}
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
              </DragItem>
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
                  <button className={styles.popoverItem} onClick={() => handleAddView("table")}>
                    <Table2 size={14} />
                    <span>Table</span>
                  </button>
                  <button className={styles.popoverItem} onClick={() => handleAddView("board")}>
                    <Kanban size={14} />
                    <span>Board</span>
                  </button>
                  <button className={styles.popoverItem} onClick={() => handleAddView("list")}>
                    <ListIcon size={14} />
                    <span>List</span>
                  </button>
                  <button className={styles.popoverItem} onClick={() => handleAddView("calendar")}>
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

            {/* Filter Toggle Button */}
            <button
              className={`${styles.toolbarActionBtn} ${showFilterBar || activeFilterRules.length > 0 ? styles.toolbarActionBtnActive : ""}`}
              onClick={() => setShowFilterBar((prev) => !prev)}
              title="Filter entries"
            >
              <Filter size={13} />
              <span>
                Filter
                {activeFilterRules.length > 0 && ` (${activeFilterRules.length})`}
              </span>
            </button>

            {/* Sort Popover Button */}
            <div style={{ position: "relative" }} ref={sortPopoverRef}>
              <button
                className={`${styles.toolbarActionBtn} ${Boolean(currentView?.sorts?.length) ? styles.toolbarActionBtnActive : ""}`}
                onClick={() => setShowSortPopover((prev) => !prev)}
                title="Sort entries"
              >
                <ArrowUpDown size={13} />
                <span>
                  Sort
                  {Boolean(currentView?.sorts?.length) && ` (${currentView?.sorts?.length})`}
                </span>
              </button>

              {showSortPopover && currentView && (
                <div className={styles.viewPopover} style={{ minWidth: 280, right: 0, left: "auto" }}>
                  <div className={styles.popoverHeader}>Sort by</div>
                  {(currentView.sorts || []).length === 0 && (
                    <div style={{ fontSize: 12, padding: "4px 8px", opacity: 0.65 }}>No sort applied</div>
                  )}
                  {currentView.sorts?.map((sort, idx) => (
                    <div key={`${sort.propertyId}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px" }}>
                      <select
                        className={styles.propSelect}
                        style={{ flex: 1, margin: 0 }}
                        value={sort.propertyId}
                        aria-label="Sort property"
                        onChange={(e) => {
                          const propertyId = e.target.value;
                          const next = currentView.sorts!
                            .map((s, i) => (i === idx ? { ...s, propertyId } : s))
                            .filter((s, i, arr) => arr.findIndex((o) => o.propertyId === s.propertyId) === i);
                          updateDatabaseView(block.id, currentView.id, { sorts: next });
                        }}
                      >
                        {sortableProps
                          .filter((p) => p.id === sort.propertyId || !currentView.sorts?.some((s) => s.propertyId === p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                      <button
                        className={styles.sortToggleBtn}
                        title="Toggle direction"
                        onClick={() => {
                          const next: { propertyId: string; direction: "asc" | "desc" }[] = currentView.sorts!.map((s, i) =>
                            i === idx ? { ...s, direction: s.direction === "asc" ? ("desc" as const) : ("asc" as const) } : s
                          );
                          updateDatabaseView(block.id, currentView.id, { sorts: next });
                        }}
                      >
                        {sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        <span>{sort.direction === "asc" ? "Asc" : "Desc"}</span>
                      </button>
                      <button
                        className={styles.deleteViewBtn}
                        title="Remove sort"
                        onClick={() => {
                          const next = currentView.sorts!.filter((_, i) => i !== idx);
                          updateDatabaseView(block.id, currentView.id, { sorts: next });
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className={styles.popoverItem}
                    disabled={sortableProps.every((p) => currentView.sorts?.some((s) => s.propertyId === p.id))}
                    onClick={() => {
                      const firstAvail = sortableProps.find(
                        (p) => !currentView.sorts?.some((s) => s.propertyId === p.id)
                      );
                      if (firstAvail) {
                        const next = [...(currentView.sorts || []), { propertyId: firstAvail.id, direction: "asc" as const }];
                        updateDatabaseView(block.id, currentView.id, { sorts: next });
                      }
                    }}
                  >
                    <Plus size={13} />
                    <span>Add sort</span>
                  </button>
                  {Boolean(currentView.sorts?.length) && (
                    <button
                      className={styles.popoverItem}
                      onClick={() => {
                        updateDatabaseView(block.id, currentView.id, { sorts: [] });
                        setShowSortPopover(false);
                      }}
                    >
                      <X size={13} />
                      <span>Remove all sorts</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Properties Visibility & Management Popover */}
            <div style={{ position: "relative" }} ref={propsPopoverRef}>
              <button
                className={styles.toolbarActionBtn}
                onClick={() => setShowPropsPopover((prev) => !prev)}
                title="Manage properties"
              >
                <SlidersHorizontal size={13} />
                <span>Properties</span>
              </button>

              {showPropsPopover && (
                <div className={styles.viewPopover} style={{ minWidth: 220, right: 0, left: "auto" }}>
                  <div className={styles.popoverHeader}>Database Properties</div>
                  {dbProperties.map((prop) => (
                    <div
                      key={prop.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ textDecoration: prop.isDeleted ? "line-through" : "none", opacity: prop.isDeleted ? 0.6 : 1 }}>
                          {prop.name}
                        </span>
                        {prop.isDeleted && <span className={styles.nullBadge}>null</span>}
                      </span>
                      {prop.isDeleted ? (
                        <button
                          className={styles.sortToggleBtn}
                          onClick={() => restoreDatabaseProperty(block.id, prop.id)}
                          title="Restore core property"
                        >
                          <RotateCcw size={12} />
                        </button>
                      ) : (
                        <button
                          className={styles.deleteViewBtn}
                          onClick={() => deleteDatabaseProperty(block.id, prop.id)}
                          title="Delete property"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!readOnly && !embedded && (
              <button
                type="button"
                className={styles.toolbarActionBtn}
                onClick={() => setShowTemplatesModal(true)}
                title="Page templates"
              >
                <LayoutTemplate size={13} />
                <span>
                  Templates{dbTemplates.length > 0 ? ` (${dbTemplates.length})` : ""}
                </span>
              </button>
            )}

            {!readOnly && (
              <button
                className={styles.newBtn}
                onClick={() => {
                  const newRow = createDatabaseRow(block.id);
                  setSidePeekBlock(newRow.id);
                }}
              >
                <Plus size={14} />
                <span>New</span>
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Filter Bar Builder */}
        {showFilterBar && currentView && (
          <div className={styles.filterBarContainer}>
            <div className={styles.filterHeaderRow}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-secondary)" }}>
                Filter rules ({activeFilterRules.length})
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={styles.filterTextBtn}
                  onClick={() => {
                    const nextOp = currentView.filter?.operator === "or" ? "and" : "or";
                    updateActiveFilterRules(activeFilterRules, nextOp);
                  }}
                >
                  Conjunction: {currentView.filter?.operator?.toUpperCase() || "AND"}
                </button>
                <button
                  className={styles.filterTextBtn}
                  style={{ color: "#eb5757" }}
                  onClick={() => updateActiveFilterRules([], "and")}
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className={styles.filterRuleList}>
              {activeFilterRules.map((rule, idx) => {
                const ruleProp = dbProperties.find((p) => p.id === rule.propertyId);
                const isRelationProp = ruleProp?.type === "relation";
                const relationTargets = isRelationProp
                  ? ruleProp.targetDatabaseId === "__any__"
                    ? Object.values(blocks).filter((b) => !b.isArchived && (b.type === "page" || b.type === "database"))
                    : (childrenIndex[ruleProp.targetDatabaseId || block.id] || [])
                        .map((id) => blocks[id])
                        .filter((b) => Boolean(b) && !b.isArchived)
                  : [];

                return (
                <div key={idx} className={styles.filterRuleRow}>
                  {/* Property Selector */}
                  <select
                    className={styles.filterSelect}
                    value={rule.propertyId}
                    onChange={(e) => {
                      const nextRules = activeFilterRules.map((r, i) =>
                        i === idx ? { ...r, propertyId: e.target.value } : r
                      );
                      updateActiveFilterRules(nextRules);
                    }}
                  >
                    {dbProperties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.isDeleted ? "(deleted: null)" : ""}
                      </option>
                    ))}
                  </select>

                  {/* Operator Selector */}
                  <select
                    className={styles.filterSelect}
                    value={rule.operator}
                    onChange={(e) => {
                      const nextRules = activeFilterRules.map((r, i) =>
                        i === idx ? { ...r, operator: e.target.value as ViewFilterRule["operator"] } : r
                      );
                      updateActiveFilterRules(nextRules);
                    }}
                  >
                    <option value="equals">equals</option>
                    <option value="does_not_equal">does not equal</option>
                    <option value="contains">contains</option>
                    <option value="does_not_contain">does not contain</option>
                    <option value="is_empty">is empty (null)</option>
                    <option value="is_not_empty">is not empty</option>
                    <option value="greater_than">greater than</option>
                    <option value="less_than">less than</option>
                    <option value="is_today">is today</option>
                    <option value="is_overdue">is overdue</option>
                    <option value="next_7_days">next 7 days</option>
                  </select>

                  {/* Value Input (unless unary empty/today/overdue) */}
                  {!["is_empty", "is_not_empty", "is_today", "is_overdue", "next_7_days"].includes(rule.operator) && (
                    isRelationProp ? (
                      <select
                        className={styles.filterSelect}
                        value={String(rule.value ?? "")}
                        onChange={(e) => {
                          const nextRules = activeFilterRules.map((r, i) =>
                            i === idx ? { ...r, value: e.target.value } : r
                          );
                          updateActiveFilterRules(nextRules);
                        }}
                      >
                        <option value="">Select page...</option>
                        {currentPageId && (
                          <option value="$this">This page ($this)</option>
                        )}
                        {relationTargets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.icon || "📄"} {t.title || "Untitled"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.filterInput}
                        placeholder="Value (or $today / $this)..."
                        value={String(rule.value ?? "")}
                        onChange={(e) => {
                          const nextRules = activeFilterRules.map((r, i) =>
                            i === idx ? { ...r, value: e.target.value } : r
                          );
                          updateActiveFilterRules(nextRules);
                        }}
                      />
                    )
                  )}

                  <button
                    className={styles.filterRemoveBtn}
                    onClick={() => {
                      const nextRules = activeFilterRules.filter((_, i) => i !== idx);
                      updateActiveFilterRules(nextRules);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                );
              })}
            </div>

            <div className={styles.filterBottomActions}>
              <button
                className={styles.filterTextBtn}
                onClick={() => {
                  const firstProp = dbProperties[0]?.id || "prop-title";
                  const nextRules = [...activeFilterRules, { propertyId: firstProp, operator: "contains" as const, value: "" }];
                  updateActiveFilterRules(nextRules);
                }}
              >
                <Plus size={13} />
                <span>Add filter rule</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* View Content (Table, Board, List, or Calendar) */}
      <div className={styles.contentArea}>
        {/* TABLE VIEW */}
        {(!currentView || currentView.layout === "table") && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thMain} {...contextMenuProps(() => columnMenu("prop-title"))}>
                    <div className={styles.thContent}>
                      <div className={styles.thTitleGroup}>
                        <span>Name</span>
                        <button
                          className={`${styles.sortToggleBtn} ${currentView?.sorts?.some((s) => s.propertyId === "prop-title") ? styles.sortToggleBtnActive : ""}`}
                          onClick={() => handleToggleColumnSort("prop-title")}
                          title="Sort by Name"
                        >
                          {currentView?.sorts?.find((s) => s.propertyId === "prop-title")?.direction === "desc" ? (
                            <ArrowDown size={12} />
                          ) : currentView?.sorts?.find((s) => s.propertyId === "prop-title")?.direction === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </button>
                      </div>
                    </div>
                  </th>
                  {dynamicProps.map((prop) => {
                    const sortConfig = currentView?.sorts?.find((s) => s.propertyId === prop.id);
                    return (
                      <th key={prop.id} className={styles.th} {...contextMenuProps(() => columnMenu(prop.id))}>
                        <div className={styles.thContent}>
                          <div className={styles.thTitleGroup}>
                            <span style={{ textDecoration: prop.isDeleted ? "line-through" : "none", opacity: prop.isDeleted ? 0.6 : 1 }}>
                              {prop.name}
                            </span>
                            {prop.isDeleted && <span className={styles.nullBadge}>null</span>}
                            <button
                              className={`${styles.sortToggleBtn} ${sortConfig ? styles.sortToggleBtnActive : ""}`}
                              onClick={() => handleToggleColumnSort(prop.id)}
                              title={`Sort by ${prop.name}`}
                            >
                              {sortConfig?.direction === "desc" ? (
                                <ArrowDown size={12} />
                              ) : sortConfig?.direction === "asc" ? (
                                <ArrowUp size={12} />
                              ) : (
                                <ArrowUpDown size={12} />
                              )}
                            </button>
                          </div>

                          {/* Quick delete or restore on header */}
                          {prop.isDeleted ? (
                            <button
                              className={styles.thMenuBtn}
                              title="Restore core property"
                              onClick={() => restoreDatabaseProperty(block.id, prop.id)}
                            >
                              <RotateCcw size={12} />
                            </button>
                          ) : (
                            <button
                              className={styles.thMenuBtn}
                              title="Delete property"
                              onClick={() => deleteDatabaseProperty(block.id, prop.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </th>
                    );
                  })}
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
                          onChange={(e) => setNewPropType(e.target.value as PropertyType)}
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="select">Select</option>
                          <option value="multi_select">Multi-select</option>
                          <option value="status">Status</option>
                          <option value="date">Date</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="relation">Relation</option>
                          <option value="email">Email</option>
                          <option value="url">URL</option>
                        </select>
                        {newPropType === "relation" && (
                          <select
                            className={styles.propSelect}
                            value={newPropTargetDb}
                            onChange={(e) => setNewPropTargetDb(e.target.value)}
                          >
                            <option value="__any__">Target: Any page in workspace</option>
                            {allDatabases.map((db) => (
                              <option key={db.id} value={db.id}>
                                Target: {db.title || "Untitled Database"}
                              </option>
                            ))}
                          </select>
                        )}
                        <button className={styles.createPropBtn} onClick={handleAddProperty}>
                          Create Property
                        </button>
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {processedRows.map((row) => (
                  <DragItem
                    as="tr"
                    id={`row:${row.id}`}
                    key={row.id}
                    className={styles.tr}
                    draggingClassName={styles.dragging}
                    overClassName={styles.dropTargetRow}
                    {...contextMenuProps(() => rowMenu(row.id))}
                  >
                    <td className={styles.tdMain} onClick={() => setSidePeekBlock(row.id)}>
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
                      if (prop.isDeleted) {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <span className={styles.nullBadge}>null</span>
                          </td>
                        );
                      }

                      const val = row.properties?.[prop.id];

                      if (prop.type === "status") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <select
                              className={styles.cellSelect}
                              value={(val as string) || ""}
                              onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
                            >
                              <option value="">Empty</option>
                              {prop.options?.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name}
                                </option>
                              ))}
                            </select>
                            <div className={styles.pillDisplay}>{renderStatusPill(val)}</div>
                          </td>
                        );
                      }

                      if (prop.type === "select" || prop.id === "prop-priority") {
                        return (
                          <td key={prop.id} className={styles.td}>
                            <select
                              className={styles.cellSelect}
                              value={(val as string) || ""}
                              onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
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

                      if (prop.type === "multi_select") {
                        return (
                          <td key={prop.id} className={styles.td} onClick={() => setSidePeekBlock(row.id)}>
                            {Array.isArray(val) && val.length > 0 ? (
                              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                {val.map((item) => {
                                  const opt = prop.options?.find((o) => o.id === item);
                                  return (
                                    <span key={item} className={`${styles.pill} ${styles[`pill_${opt?.color || "default"}`]}`}>
                                      {opt?.name || item}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className={styles.emptyCell}>Empty</span>
                            )}
                          </td>
                        );
                      }

                      if (prop.type === "relation") {
                        const targetIds = Array.isArray(val) ? val : [];
                        return (
                          <td key={prop.id} className={styles.td} onClick={() => setSidePeekBlock(row.id)}>
                            {targetIds.length > 0 ? (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {targetIds.map((tid) => (
                                  <span key={tid} className={styles.cardDate}>
                                    📄 {blocks[tid]?.title || "Linked page"}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className={styles.emptyCell}>Empty</span>
                            )}
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
                              onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
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
                              onChange={(e) => updateRowProperty(row.id, prop.id, e.target.checked)}
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

                      return (
                        <td key={prop.id} className={styles.td}>
                          <input
                            type="text"
                            className={styles.inlineTextInput}
                            value={(val as string) || ""}
                            onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
                            placeholder="Empty"
                          />
                        </td>
                      );
                    })}

                    <td className={styles.td} />
                  </DragItem>
                ))}
              </tbody>
              {/* Footer Calculation Row */}
              <tfoot className={styles.tfoot}>
                <tr>
                  <td className={styles.tdCalc}>
                    <span style={{ fontSize: 11 }}>{processedRows.length} rows</span>
                  </td>
                  {dynamicProps.map((prop) => {
                    const currentCalc = currentView?.calculations?.[prop.id] || "none";
                    return (
                      <td key={prop.id} className={styles.tdCalc}>
                        <select
                          className={styles.cellSelect}
                          value={currentCalc}
                          onChange={(e) => {
                            const nextCalcs = {
                              ...(currentView?.calculations || {}),
                              [prop.id]: e.target.value as CalculationType,
                            };
                            updateDatabaseView(block.id, currentView!.id, { calculations: nextCalcs });
                          }}
                        >
                          <option value="none">None</option>
                          <option value="count_all">Count all</option>
                          <option value="count_values">Count values</option>
                          <option value="count_empty">Count empty</option>
                          <option value="percent_empty">Percent empty</option>
                          <option value="percent_not_empty">Percent not empty</option>
                          {prop.type === "number" && (
                            <>
                              <option value="sum">Sum</option>
                              <option value="average">Average</option>
                              <option value="min">Min</option>
                              <option value="max">Max</option>
                            </>
                          )}
                        </select>
                        <span className={styles.calcTrigger}>
                          {calculateMetric(prop.id, currentCalc) || "Calculate"}
                        </span>
                      </td>
                    );
                  })}
                  <td className={styles.tdCalc} />
                </tr>
              </tfoot>
            </table>

            <button
              className={styles.addBottomRowBtn}
              onClick={() => createDatabaseRow(block.id, "New entry")}
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>
        )}

        {/* BOARD VIEW (Drag and drop between different statuses & groups) */}
        {currentView?.layout === "board" && (
          <div className={styles.boardWrapper}>
            {(() => {
              const groupProp = statusProp;
              const isGroupDeleted = groupProp?.isDeleted;

              // If grouping property is marked deleted, display a single fallback null column
              if (isGroupDeleted) {
                return (
                  <DropZone
id="col:__null__"
className={styles.boardColumn}
overClassName={styles.boardColumnDropActive}
{...contextMenuProps(() => newEntryMenu("New entry (no status)", {}))}
>
                    <div className={styles.columnHeader}>
                      <span className={styles.nullBadge}>Status: null (Deleted)</span>
                      <button
                        className={styles.sortToggleBtn}
                        onClick={() => restoreDatabaseProperty(block.id, groupProp.id)}
                        title="Restore Status Property"
                      >
                        <RotateCcw size={12} />
                        <span>Restore</span>
                      </button>
                    </div>
                    <div className={styles.cardList}>
                      {processedRows.map((card) => (
                        <DragItem
key={card.id}
id={`row:${card.id}`}
className={styles.boardCard}
draggingClassName={styles.dragging}
overClassName={styles.dropTargetRow}
onClick={() => setSidePeekBlock(card.id)}
{...contextMenuProps(() => rowMenu(card.id))}
>
                          <div className={styles.cardTitleRow}>
                            <span className={styles.cardIcon}>{card.icon || "📄"}</span>
                            <span className={styles.cardTitle}>{card.title || "Untitled"}</span>
                          </div>
                        </DragItem>
                      ))}
                    </div>
                  </DropZone>
                );
              }

              const columns = groupProp?.options || [
                { id: "opt-todo", name: "To Do", color: "gray" },
                { id: "opt-progress", name: "In Progress", color: "blue" },
                { id: "opt-done", name: "Done", color: "green" },
              ];

              // Check if any card has no status (null / unassigned)
              const unassignedRows = processedRows.filter(
                (r) => !r.properties?.[groupProp?.id || "prop-status"]
              );

              return (
                <>
                  {/* Unassigned / No status column if any exists */}
                  {unassignedRows.length > 0 && (
                    <DropZone
id="col:__null__"
className={styles.boardColumn}
overClassName={styles.boardColumnDropActive}
{...contextMenuProps(() => newEntryMenu("New entry (no status)", {}))}
>
                      <div className={styles.columnHeader}>
                        <span className={styles.nullBadge}>No Status (null)</span>
                        <span className={styles.columnCount}>{unassignedRows.length}</span>
                      </div>
                      <div className={styles.cardList}>
                        {unassignedRows.map((card) => (
                          <DragItem
key={card.id}
id={`row:${card.id}`}
className={styles.boardCard}
draggingClassName={styles.dragging}
overClassName={styles.dropTargetRow}
onClick={() => setSidePeekBlock(card.id)}
{...contextMenuProps(() => rowMenu(card.id))}
>
                            <div className={styles.cardTitleRow}>
                              <span className={styles.cardIcon}>{card.icon || "📄"}</span>
                              <span className={styles.cardTitle}>{card.title || "Untitled"}</span>
                            </div>
                          </DragItem>
                        ))}
                      </div>
                    </DropZone>
                  )}

                  {/* Standard status columns */}
                  {columns.map((column) => {
                    const columnRows = processedRows.filter(
                      (r) => (r.properties?.[groupProp?.id || "prop-status"] as string) === column.id
                    );

                    return (
                      <DropZone
key={column.id}
id={`col:${column.id}`}
className={styles.boardColumn}
overClassName={styles.boardColumnDropActive}
{...contextMenuProps(() => newEntryMenu(`New entry in ${column.name}`, { [groupProp?.id || "prop-status"]: column.id }))}
>
                        <div className={styles.columnHeader}>
                          <span className={`${styles.pill} ${styles[`pill_${column.color || "default"}`]}`}>
                            {column.name}
                          </span>
                          <span className={styles.columnCount}>{columnRows.length}</span>
                        </div>

                        <div className={styles.cardList}>
                          {columnRows.map((card) => (
                            <DragItem
key={card.id}
id={`row:${card.id}`}
className={styles.boardCard}
draggingClassName={styles.dragging}
overClassName={styles.dropTargetRow}
onClick={() => setSidePeekBlock(card.id)}
{...contextMenuProps(() => rowMenu(card.id))}
>
                              <div className={styles.cardTitleRow}>
                                <span className={styles.cardIcon}>{card.icon || "📄"}</span>
                                <span className={styles.cardTitle}>{card.title || "Untitled"}</span>
                              </div>

                              <div className={styles.cardBadges}>
                                {priorityProp && !priorityProp.isDeleted && (
                                  <div className={styles.badgeWrapper}><div className={styles.pillDisplay}>
                                      {renderPriorityPill(card.properties?.[priorityProp.id])}
                                    </div>
                                  </div>
                                )}

                                {priorityProp?.isDeleted && <span className={styles.nullBadge}>null</span>}

                                {card.properties?.["prop-due"] ? (
                                  <span className={styles.cardDate}>
                                    {String(card.properties["prop-due"])}
                                  </span>
                                ) : null}
                              </div>
                            </DragItem>
                          ))}
                        </div>

                        <button
                          className={styles.addCardBtn}
                          onClick={() => {
                            const initialProps: Record<string, unknown> = {};
                            if (groupProp) {
                              initialProps[groupProp.id] = column.id;
                            }
                            const newRow = createDatabaseRow(block.id, "New task", initialProps);
                            setSidePeekBlock(newRow.id);
                          }}
                        >
                          <Plus size={13} />
                          <span>New</span>
                        </button>
                      </DropZone>
                    );
                  })}

                  {/* Add status group button */}
                  <div style={{ position: "relative" }} ref={addGroupPopoverRef}>
                    <button
                      className={styles.addGroupColumnBtn}
                      onClick={() => setShowAddGroupPopover((prev) => !prev)}
                    >
                      <Plus size={14} />
                      <span>Add group</span>
                    </button>

                    {showAddGroupPopover && groupProp && (
                      <div className={styles.propPopover} style={{ left: 0, top: 40 }}>
                        <div className={styles.popoverHeader}>New Status Option</div>
                        <input
                          autoFocus
                          className={styles.propInput}
                          placeholder="Option name..."
                          value={newGroupOptionName}
                          onChange={(e) => setNewGroupOptionName(e.target.value)}
                        />
                        <button
                          className={styles.createPropBtn}
                          onClick={() => {
                            if (!newGroupOptionName.trim()) return;
                            const newOpt = {
                              id: `opt-${Date.now()}`,
                              name: newGroupOptionName.trim(),
                              color: "blue",
                            };
                            const nextOptions = [...(groupProp.options || []), newOpt];
                            updateDatabaseProperty(block.id, groupProp.id, { options: nextOptions });
                            setNewGroupOptionName("");
                            setShowAddGroupPopover(false);
                          }}
                        >
                          Add Option
                        </button>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* LIST VIEW */}
        {currentView?.layout === "list" && (
          <div className={styles.listWrapper}>
            {processedRows.map((row) => (
              <DragItem
key={row.id}
id={`row:${row.id}`}
className={styles.listItem}
draggingClassName={styles.dragging}
overClassName={styles.dropTargetRow}
onClick={() => setSidePeekBlock(row.id)}
{...contextMenuProps(() => rowMenu(row.id))}
>
                <div className={styles.listItemMain}>
                  <span className={styles.rowIcon}>{row.icon || "📄"}</span>
                  <input
                    className={styles.listItemTitle}
                    value={row.title || ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateRowProperty(row.id, "prop-title", e.target.value)}
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

                <div className={styles.listItemProps}>
                  {statusProp?.isDeleted ? (
                    <span className={styles.nullBadge}>null</span>
                  ) : statusProp ? (
                    <div className={styles.badgeWrapper}><div className={styles.pillDisplay}>
                        {renderStatusPill(row.properties?.[statusProp.id])}
                      </div>
                    </div>
                  ) : null}

                  {priorityProp?.isDeleted ? (
                    <span className={styles.nullBadge}>null</span>
                  ) : priorityProp ? (
                    <div className={styles.badgeWrapper}><div className={styles.pillDisplay}>
                        {renderPriorityPill(row.properties?.[priorityProp.id])}
                      </div>
                    </div>
                  ) : null}

                  {row.properties?.["prop-due"] ? (
                    <span className={styles.cardDate}>
                      {String(row.properties["prop-due"])}
                    </span>
                  ) : null}
                </div>
              </DragItem>
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
                  onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
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
                  onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
                  title="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className={styles.calendarGrid}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className={styles.calendarDayHeader}>
                  {day}
                </div>
              ))}

              {calendarDays.map((cell, idx) => {
                const cellRows = processedRows.filter(
                  (r) =>
                    r.properties?.["prop-due"] === cell.dateString ||
                    r.properties?.["date"] === cell.dateString
                );
                const isToday = cell.dateString === todayString;

                return (
                  <DropZone
                    key={idx}
                    id={`day:${cell.dateString}`}
                    overClassName={styles.dropTargetRow}
                    className={`${styles.calendarDayCell} ${!cell.isCurrentMonth ? styles.calendarDayCellOtherMonth : ""}`}
                    {...contextMenuProps(() => newEntryMenu(`New entry on ${cell.dateString}`, { "prop-due": cell.dateString }))}
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
                          const newRow = createDatabaseRow(block.id, "New entry", {
                            "prop-due": cell.dateString,
                          });
                          setSidePeekBlock(newRow.id);
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <div className={styles.calendarEventsList}>
                      {cellRows.map((item) => (
                        <DragItem
                          key={item.id}
                          id={`row:${item.id}`}
                          className={styles.calendarEventItem}
                          draggingClassName={styles.dragging}
                          onClick={() => setSidePeekBlock(item.id)}
                          {...contextMenuProps(() => rowMenu(item.id))}
                          title={item.title || "Untitled"}
                        >
                          <span>{item.icon || "📄"}</span>
                          <span>{item.title || "Untitled"}</span>
                        </DragItem>
                      ))}
                    </div>
                  </DropZone>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>

    {showTemplatesModal && (
      <DatabaseTemplatesModal
        database={block}
        properties={dbProperties}
        onClose={() => setShowTemplatesModal(false)}
        onCreateFromTemplate={(templateId) => {
          const newRow = createDatabaseRow(block.id, undefined, {}, templateId);
          setSidePeekBlock(newRow.id);
        }}
      />
    )}
    </DragProvider>
  );
}
