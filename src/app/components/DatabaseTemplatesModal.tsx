"use client";

import React, { useState } from "react";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block, DatabaseProperty, DatabaseTemplate } from "@/lib/model";
import TeamspaceEditor from "./TeamspaceEditor";
import {
  Plus,
  Trash2,
  Edit2,
  Star,
  Play,
  X,
  ArrowLeft,
  Calendar,
  Sparkles,
} from "lucide-react";
import styles from "./DatabaseTemplatesModal.module.css";

export default function DatabaseTemplatesModal({
  database,
  properties,
  onClose,
  onCreateFromTemplate,
}: {
  database: Block;
  properties: DatabaseProperty[];
  onClose: () => void;
  onCreateFromTemplate: (templateId: string) => void;
}) {
  const {
    templates,
    createDatabaseTemplate,
    updateDatabaseTemplate,
    deleteDatabaseTemplate,
  } = useWorkspace();

  const dbTemplates = templates?.[database.id] || [];
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const editingTemplate = dbTemplates.find((t) => t.id === editingTemplateId) || null;

  const handleCreateTemplate = () => {
    const created = createDatabaseTemplate(database.id, {
      name: `New ${database.title || "Entry"} Template`,
      icon: "📄",
      defaultProperties: {},
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    setEditingTemplateId(created.id);
  };

  const renderTemplateEditor = (tpl: DatabaseTemplate) => {
    const virtualBlock: Block = {
      id: "$this",
      workspaceId: database.workspaceId,
      parentId: database.id,
      type: "page",
      title: tpl.name,
      icon: tpl.icon || null,
      content: tpl.content || { type: "doc", content: [{ type: "paragraph" }] },
      position: "0",
      revision: 1,
      createdAt: tpl.createdAt,
      updatedAt: tpl.updatedAt,
    };

    const editableProps = properties.filter(
      (p) => !p.isDeleted && p.type !== "title" && p.id !== "prop-title"
    );

    return (
      <>
        {/* Navigation row and help tip */}
        <div className={styles.editorNavRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setEditingTemplateId(null)}
          >
            <ArrowLeft size={13} />
            <span>All templates</span>
          </button>
          <div className={styles.tipBanner}>
            <Sparkles size={13} color="var(--accent-blue)" />
            <span>
              Dynamic values: use <span className={styles.tipCode}>$today</span> for creation date or filter embedded views by <span className={styles.tipCode}>$this</span>
            </span>
          </div>
        </div>

        {/* Default Properties Section */}
        {editableProps.length > 0 && (
          <div className={styles.propsSection}>
            <div className={styles.propsSectionHeader}>Default Property Values</div>
            <div className={styles.propsGrid}>
              {editableProps.map((prop) => {
                const val = tpl.defaultProperties?.[prop.id];
                const setVal = (nextVal: unknown) => {
                  updateDatabaseTemplate(database.id, tpl.id, {
                    defaultProperties: {
                      ...(tpl.defaultProperties || {}),
                      [prop.id]: nextVal,
                    },
                  });
                };

                return (
                  <div key={prop.id} className={styles.propRow}>
                    <span className={styles.propLabel}>{prop.name}</span>
                    <div>
                      {prop.type === "date" || prop.id === "prop-due" ? (
                        <div className={styles.dateFieldGroup}>
                          <div className={styles.modeToggle}>
                            <button
                              type="button"
                              className={`${styles.modeBtn} ${!val ? styles.modeBtnActive : ""}`}
                              onClick={() => setVal(null)}
                            >
                              Empty
                            </button>
                            <button
                              type="button"
                              className={`${styles.modeBtn} ${val === "$today" ? styles.modeBtnActive : ""}`}
                              onClick={() => setVal("$today")}
                            >
                              Today’s date ($today)
                            </button>
                            <button
                              type="button"
                              className={`${styles.modeBtn} ${val && val !== "$today" ? styles.modeBtnActive : ""}`}
                              onClick={() => {
                                if (!val || val === "$today") {
                                  setVal(new Date().toISOString().slice(0, 10));
                                }
                              }}
                            >
                              Exact date
                            </button>
                          </div>

                          {val === "$today" ? (
                            <span className={styles.todayIndicator}>
                              <Calendar size={13} />
                              <span>Sets to the current date when new page is created</span>
                            </span>
                          ) : val && val !== "$today" ? (
                            <input
                              type="date"
                              className={styles.input}
                              value={String(val)}
                              onChange={(e) => setVal(e.target.value)}
                            />
                          ) : null}
                        </div>
                      ) : prop.type === "select" || prop.type === "status" ? (
                        <select
                          className={styles.input}
                          value={String(val ?? "")}
                          onChange={(e) => setVal(e.target.value || null)}
                        >
                          <option value="">Empty</option>
                          {prop.options?.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      ) : prop.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(val)}
                          onChange={(e) => setVal(e.target.checked)}
                        />
                      ) : (
                        <input
                          className={styles.input}
                          value={String(val ?? "")}
                          placeholder={`Default ${prop.name}...`}
                          onChange={(e) => setVal(e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Page Canvas Editor */}
        <div className={styles.editorContainer}>
          <TeamspaceEditor
            key={tpl.id}
            block={virtualBlock}
            hideProperties
            onBlockChange={(updates) => {
              const next: Partial<DatabaseTemplate> = {};
              if (updates.title !== undefined) next.name = updates.title;
              if (updates.icon !== undefined) next.icon = updates.icon;
              if (updates.content !== undefined) next.content = updates.content;
              updateDatabaseTemplate(database.id, tpl.id, next);
            }}
          />
        </div>
      </>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <span>{database.icon || "📊"}</span>
            <span>
              {editingTemplate
                ? `Edit template: ${editingTemplate.name}`
                : `${database.title} — Page Templates`}
            </span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {editingTemplate ? (
            renderTemplateEditor(editingTemplate)
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  Define reusable page layouts, default values, and embedded views for new rows.
                </span>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleCreateTemplate}
                >
                  <Plus size={14} />
                  <span>New template</span>
                </button>
              </div>

              {dbTemplates.length === 0 ? (
                <div
                  style={{
                    padding: "36px 16px",
                    textAlign: "center",
                    border: "1.5px dashed var(--border-subtle)",
                    borderRadius: 10,
                    color: "var(--text-muted)",
                    fontSize: 13,
                    background: "var(--bg-card)",
                  }}
                >
                  No templates created yet. Click <strong>New template</strong> to create one.
                </div>
              ) : (
                <div className={styles.templateList}>
                  {dbTemplates.map((tpl) => (
                    <div key={tpl.id} className={styles.templateRow}>
                      <div className={styles.templateInfo}>
                        <span style={{ fontSize: 18 }}>{tpl.icon || "📄"}</span>
                        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{tpl.name}</span>
                        {tpl.isDefault && <span className={styles.defaultBadge}>Default</span>}
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => {
                            onCreateFromTemplate(tpl.id);
                            onClose();
                          }}
                        >
                          <Play size={12} />
                          <span>Use</span>
                        </button>
                        {!tpl.isDefault && (
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() =>
                              updateDatabaseTemplate(database.id, tpl.id, { isDefault: true })
                            }
                          >
                            <Star size={12} />
                            <span>Set default</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.btn}
                          onClick={() => setEditingTemplateId(tpl.id)}
                        >
                          <Edit2 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger}`}
                          onClick={() => deleteDatabaseTemplate(database.id, tpl.id)}
                          title="Delete template"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
