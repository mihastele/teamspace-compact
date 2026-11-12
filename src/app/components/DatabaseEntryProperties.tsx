"use client";

import React, { useState, useRef, useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block, PropertyType } from "@/lib/model";
import {
  Type,
  Hash,
  List,
  CheckCircle2,
  Calendar,
  CheckSquare,
  Link2,
  Mail,
  Phone,
  ArrowRightLeft,
  User,
  Plus,
  Trash2,
  RotateCcw,
  X,
  Check,
} from "lucide-react";
import styles from "./DatabaseEntryProperties.module.css";
import viewStyles from "./DatabaseView.module.css";

const PROPERTY_ICONS: Record<string, React.ReactNode> = {
  title: <Type size={13} />,
  text: <Type size={13} />,
  number: <Hash size={13} />,
  select: <List size={13} />,
  multi_select: <List size={13} />,
  status: <CheckCircle2 size={13} />,
  date: <Calendar size={13} />,
  checkbox: <CheckSquare size={13} />,
  url: <Link2 size={13} />,
  email: <Mail size={13} />,
  phone: <Phone size={13} />,
  relation: <ArrowRightLeft size={13} />,
  person: <User size={13} />,
};

export default function DatabaseEntryProperties({ row }: { row: Block }) {
  const {
    blocks,
    childrenIndex,
    properties,
    updateRowProperty,
    deleteDatabaseProperty,
    restoreDatabaseProperty,
    createDatabaseProperty,
    setSidePeekBlock,
  } = useWorkspace();

  const databaseId = row.parentId || "";
  const dbProps = databaseId ? properties[databaseId] || [] : [];

  // Popover state for Relation selection
  const [activeRelationPropId, setActiveRelationPropId] = useState<string | null>(null);
  const [relationSearch, setRelationSearch] = useState("");

  // Popover state for adding a new property
  const [showAddProp, setShowAddProp] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");

  const relationPopoverRef = useRef<HTMLDivElement>(null);
  const addPropPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        relationPopoverRef.current &&
        !relationPopoverRef.current.contains(e.target as Node)
      ) {
        setActiveRelationPropId(null);
      }
      if (
        addPropPopoverRef.current &&
        !addPropPopoverRef.current.contains(e.target as Node)
      ) {
        setShowAddProp(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveRelationPropId(null);
        setShowAddProp(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!databaseId || dbProps.length === 0) {
    return null;
  }

  // Filter out title property since page title is edited in the main canvas
  const editableProps = dbProps.filter((p) => p.type !== "title" && p.id !== "prop-title");

  return (
    <div className={styles.propertiesContainer}>
      {editableProps.map((prop) => {
        const isDeletedCore = prop.isDeleted;
        const val = row.properties?.[prop.id];

        return (
          <div
            key={prop.id}
            className={`${styles.propertyRow} ${isDeletedCore ? styles.propertyRowDeleted : ""}`}
          >
            {/* Property Label & Icon */}
            <div className={styles.propertyLabel}>
              <span className={styles.propertyLabelIcon}>
                {PROPERTY_ICONS[prop.type] || <Type size={13} />}
              </span>
              <span>{prop.name}</span>
            </div>

            {/* Property Value Area */}
            <div className={styles.propertyValueArea}>
              {/* If core property is deleted: display null & restore button */}
              {isDeletedCore ? (
                <>
                  <span className={styles.nullPill}>null</span>
                  <button
                    className={styles.restorePropertyBtn}
                    onClick={() => restoreDatabaseProperty(databaseId, prop.id)}
                    title="Restore this core property"
                  >
                    <RotateCcw size={12} />
                    <span>Restore</span>
                  </button>
                </>
              ) : prop.type === "status" ? (
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.nativeSelect}
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
                  {(() => {
                    const opt = prop.options?.find((o) => o.id === val);
                    return opt ? (
                      <span className={`${viewStyles.pill} ${viewStyles[`pill_${opt.color || "default"}`]}`}>
                        {opt.name}
                      </span>
                    ) : (
                      <span className={viewStyles.emptyCell}>Empty</span>
                    );
                  })()}
                </div>
              ) : prop.type === "select" ? (
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.nativeSelect}
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
                  {(() => {
                    const opt = prop.options?.find((o) => o.id === val);
                    return opt ? (
                      <span className={`${viewStyles.pill} ${viewStyles[`pill_${opt.color || "default"}`]}`}>
                        {opt.name}
                      </span>
                    ) : (
                      <span className={viewStyles.emptyCell}>Empty</span>
                    );
                  })()}
                </div>
              ) : prop.type === "multi_select" ? (
                <div className={styles.tagsList}>
                  {Array.isArray(val) &&
                    val.map((optId) => {
                      const opt = prop.options?.find((o) => o.id === optId);
                      return (
                        <span
                          key={optId}
                          className={`${viewStyles.pill} ${viewStyles[`pill_${opt?.color || "default"}`]}`}
                        >
                          {opt?.name || optId}
                          <span
                            className={styles.tagRemoveBtn}
                            onClick={() => {
                              const next = (val as string[]).filter((x) => x !== optId);
                              updateRowProperty(row.id, prop.id, next);
                            }}
                          >
                            <X size={11} />
                          </span>
                        </span>
                      );
                    })}
                  {/* Select additional tags */}
                  <div className={styles.selectWrapper}>
                    <select
                      className={styles.nativeSelect}
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const current = Array.isArray(val) ? (val as string[]) : [];
                        if (!current.includes(e.target.value)) {
                          updateRowProperty(row.id, prop.id, [...current, e.target.value]);
                        }
                      }}
                    >
                      <option value="">+ Add tag</option>
                      {prop.options
                        ?.filter((opt) => !(Array.isArray(val) && val.includes(opt.id)))
                        .map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name}
                          </option>
                        ))}
                    </select>
                    <span className={styles.addRelationTrigger}>+ Tag</span>
                  </div>
                </div>
              ) : prop.type === "relation" ? (
                <div className={styles.relationPills}>
                  {Array.isArray(val) &&
                    val.map((targetId) => {
                      const targetBlock = blocks[targetId];
                      return (
                        <span
                          key={targetId}
                          className={styles.relationPill}
                          onClick={() => setSidePeekBlock(targetId)}
                          title="Open linked ticket"
                        >
                          <span>{targetBlock?.icon || "📄"}</span>
                          <span>{targetBlock?.title || "Untitled"}</span>
                          <span
                            className={styles.tagRemoveBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = (val as string[]).filter((x) => x !== targetId);
                              updateRowProperty(row.id, prop.id, next);
                            }}
                          >
                            <X size={11} />
                          </span>
                        </span>
                      );
                    })}
                  <button
                    className={styles.addRelationTrigger}
                    onClick={() => {
                      setActiveRelationPropId(prop.id);
                      setRelationSearch("");
                    }}
                  >
                    <Plus size={12} />
                    <span>Link page</span>
                  </button>

                  {/* Searchable Relation Popover */}
                  {activeRelationPropId === prop.id && (
                    <div ref={relationPopoverRef} className={styles.dropdownPopover}>
                      <input
                        autoFocus
                        className={styles.popoverSearchInput}
                        placeholder="Search pages to link..."
                        value={relationSearch}
                        onChange={(e) => setRelationSearch(e.target.value)}
                      />
                      <div className={styles.popoverList}>
                        {(() => {
                          const targetDbId = prop.targetDatabaseId || databaseId;
                          const candidateIds = childrenIndex[targetDbId] || [];
                          const matched = candidateIds
                            .filter((id) => id !== row.id && !blocks[id]?.isArchived)
                            .map((id) => blocks[id])
                            .filter(Boolean)
                            .filter((b) =>
                              (b.title || "Untitled")
                                .toLowerCase()
                                .includes(relationSearch.toLowerCase())
                            );

                          if (matched.length === 0) {
                            return <div className={viewStyles.emptyCell}>No matching pages</div>;
                          }

                          const currentSelected = Array.isArray(val) ? (val as string[]) : [];

                          return matched.map((cand) => {
                            const isSelected = currentSelected.includes(cand.id);
                            return (
                              <div
                                key={cand.id}
                                className={`${styles.popoverRowItem} ${isSelected ? styles.popoverRowSelected : ""}`}
                                onClick={() => {
                                  const next = isSelected
                                    ? currentSelected.filter((x) => x !== cand.id)
                                    : [...currentSelected, cand.id];
                                  updateRowProperty(row.id, prop.id, next);
                                }}
                              >
                                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span>{cand.icon || "📄"}</span>
                                  <span>{cand.title || "Untitled"}</span>
                                </span>
                                {isSelected && <Check size={13} color="var(--accent-blue)" />}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              ) : prop.type === "date" ? (
                <input
                  type="date"
                  className={styles.propertyDateInput}
                  value={(val as string) || ""}
                  onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
                />
              ) : prop.type === "checkbox" ? (
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={Boolean(val)}
                  onChange={(e) => updateRowProperty(row.id, prop.id, e.target.checked)}
                />
              ) : prop.type === "number" ? (
                <input
                  type="number"
                  className={styles.propertyInput}
                  value={(val as number) ?? ""}
                  placeholder="Empty"
                  onChange={(e) =>
                    updateRowProperty(
                      row.id,
                      prop.id,
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              ) : (
                <input
                  type="text"
                  className={styles.propertyInput}
                  value={(val as string) || ""}
                  placeholder="Empty"
                  onChange={(e) => updateRowProperty(row.id, prop.id, e.target.value)}
                />
              )}
            </div>

            {/* Delete Property Action Button */}
            {!isDeletedCore && (
              <button
                className={styles.deletePropertyBtn}
                title={prop.isCore ? "Delete core property (turns null)" : "Delete property"}
                onClick={() => deleteDatabaseProperty(databaseId, prop.id)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}

      {/* Add a Property Action Button & Popover */}
      <div style={{ position: "relative" }} ref={addPropPopoverRef}>
        <button
          className={styles.addPropertyRowBtn}
          onClick={() => setShowAddProp((prev) => !prev)}
        >
          <Plus size={13} />
          <span>Add a property</span>
        </button>

        {showAddProp && (
          <div className={viewStyles.propPopover}>
            <div className={viewStyles.popoverHeader}>New Property</div>
            <input
              autoFocus
              className={viewStyles.propInput}
              placeholder="Property name"
              value={newPropName}
              onChange={(e) => setNewPropName(e.target.value)}
            />
            <select
              className={viewStyles.propSelect}
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
              <option value="phone">Phone</option>
            </select>
            <button
              className={viewStyles.createPropBtn}
              onClick={() => {
                if (!newPropName.trim()) return;
                createDatabaseProperty(databaseId, newPropName.trim(), newPropType);
                setNewPropName("");
                setNewPropType("text");
                setShowAddProp(false);
              }}
            >
              Create Property
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
