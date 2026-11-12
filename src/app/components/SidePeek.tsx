"use client";

import React, { useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import NotionEditor from "./NotionEditor";
import DatabaseEntryProperties from "./DatabaseEntryProperties";
import { X, Maximize2 } from "lucide-react";
import styles from "./SidePeek.module.css";

export default function SidePeek() {
  const {
    blocks,
    sidePeekBlockId,
    setSidePeekBlock,
    setActiveBlock,
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
        <DatabaseEntryProperties row={row} />

        {/* Full Block Editor for the row */}
        <div className={styles.editorContainer}>
          <NotionEditor key={row.id} block={row} />
        </div>
      </div>
    </div>
  );
}
