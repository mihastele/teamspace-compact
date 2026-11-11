"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import { Search, Table2, Plus, Moon, Sun } from "lucide-react";
import styles from "./CommandPalette.module.css";

export default function CommandPalette({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const {
    blocks,
    setActiveBlock,
    createPage,
    createDatabase,
    toggleTheme,
    theme,
  } = useWorkspace();

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Trigger open
        }
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const matchingBlocks = Object.values(blocks).filter(
    (b) =>
      !b.isArchived &&
      (b.title || "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Search Bar */}
        <div className={styles.searchBar}>
          <Search size={18} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search pages and commands..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className={styles.escKbd}>ESC</kbd>
        </div>

        <div className={styles.resultsList}>
          {/* Quick Actions if query matches or is empty */}
          {(!query || "new page".includes(query.toLowerCase())) && (
            <div
              className={styles.resultItem}
              onClick={() => {
                const page = createPage(null, "Untitled");
                setActiveBlock(page.id);
                onClose();
              }}
            >
              <Plus size={16} className={styles.itemIcon} />
              <div className={styles.itemText}>
                <strong>New Page</strong>
                <span>Create a blank page in workspace</span>
              </div>
            </div>
          )}

          {(!query || "new database".includes(query.toLowerCase())) && (
            <div
              className={styles.resultItem}
              onClick={() => {
                const db = createDatabase(null, "New Database");
                setActiveBlock(db.id);
                onClose();
              }}
            >
              <Table2 size={16} className={styles.itemIcon} />
              <div className={styles.itemText}>
                <strong>New Database</strong>
                <span>Create a structured database with views</span>
              </div>
            </div>
          )}

          {(!query || "toggle theme".includes(query.toLowerCase())) && (
            <div
              className={styles.resultItem}
              onClick={() => {
                toggleTheme();
                onClose();
              }}
            >
              {theme === "light" ? (
                <Moon size={16} className={styles.itemIcon} />
              ) : (
                <Sun size={16} className={styles.itemIcon} />
              )}
              <div className={styles.itemText}>
                <strong>Toggle Theme</strong>
                <span>Switch between light and dark mode</span>
              </div>
            </div>
          )}

          {/* Matching Pages and Databases */}
          {matchingBlocks.length > 0 && (
            <div className={styles.categoryHeader}>Pages & Databases</div>
          )}

          {matchingBlocks.map((block) => (
            <div
              key={block.id}
              className={styles.resultItem}
              onClick={() => {
                setActiveBlock(block.id);
                onClose();
              }}
            >
              <span className={styles.emojiIcon}>
                {block.icon || (block.type === "database" ? "🗂️" : "📄")}
              </span>
              <div className={styles.itemText}>
                <strong>{block.title || "Untitled"}</strong>
                <span>{block.type === "database" ? "Database" : "Page"}</span>
              </div>
            </div>
          ))}

          {matchingBlocks.length === 0 && query && (
            <div className={styles.emptyResults}>No matching results found</div>
          )}
        </div>
      </div>
    </div>
  );
}
