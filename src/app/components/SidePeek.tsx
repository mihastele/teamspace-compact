"use client";

import React, { useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import NotionEditor from "./NotionEditor";
import { X, Maximize2 } from "lucide-react";
import styles from "./SidePeek.module.css";

export default function SidePeek() {
  const {
    blocks,
    sidePeekBlockId,
    setSidePeekBlock,
    setActiveBlock,
    properties,
    updateRowProperty,
  } = useWorkspace();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidePeekBlockId) {
        setSidePeekBlock(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidePeekBlockId, setSidePeekBlock]);

  if (!sidePeekBlockId) return null;

  const row = blocks[sidePeekBlockId];
  if (!row) return null;

  const dbProperties = row.parentId ? properties[row.parentId] || [] : [];
  const statusProp = dbProperties.find((p) => p.type === "status");
  const priorityProp = dbProperties.find((p) => p.id === "prop-priority");

  return (
    <div className={styles.overlay} onClick={() => setSidePeekBlock(null)}>
      <div
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar */}
        <div className={styles.topBar}>
          <button
            className={styles.actionBtn}
            title="Open as full page"
            onClick={() => {
              setActiveBlock(row.id);
              setSidePeekBlock(null);
            }}
          >
            <Maximize2 size={15} />
            <span>Open as page</span>
          </button>

          <button
            className={styles.closeBtn}
            onClick={() => setSidePeekBlock(null)}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Database Properties Header inside the entry */}
        {dbProperties.length > 0 && (
          <div className={styles.propertiesSection}>
            {statusProp && (
              <div className={styles.propertyRow}>
                <span className={styles.propertyLabel}>Status</span>
                <select
                  className={styles.propertySelect}
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
              </div>
            )}

            {priorityProp && (
              <div className={styles.propertyRow}>
                <span className={styles.propertyLabel}>Priority</span>
                <select
                  className={styles.propertySelect}
                  value={(row.properties?.[priorityProp.id] as string) || ""}
                  onChange={(e) =>
                    updateRowProperty(row.id, priorityProp.id, e.target.value)
                  }
                >
                  <option value="">Empty</option>
                  {priorityProp.options?.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.propertyRow}>
              <span className={styles.propertyLabel}>Due Date</span>
              <input
                type="date"
                className={styles.propertyDate}
                value={(row.properties?.["prop-due"] as string) || ""}
                onChange={(e) =>
                  updateRowProperty(row.id, "prop-due", e.target.value)
                }
              />
            </div>
          </div>
        )}

        {/* Full Block Editor for the row */}
        <div className={styles.editorContainer}>
          <NotionEditor key={row.id} block={row} />
        </div>
      </div>
    </div>
  );
}
