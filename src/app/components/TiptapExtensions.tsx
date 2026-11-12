"use client";

import React, { createContext, useContext, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useWorkspace } from "@/lib/workspace-store";
import { formatFileSize, saveMediaFile, useMediaUrl } from "@/lib/media-store";
import type { ViewFilterRule } from "@/lib/model";
import { EmojiPicker } from "./EmojiPicker";
import {
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Plus,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import styles from "./TiptapExtensions.module.css";

export type EmbeddedDbRenderProps = {
  databaseId: string;
  viewId?: string | null;
  filterRules?: ViewFilterRule[] | null;
  currentPageId?: string;
  readOnly?: boolean;
  onUpdateNodeAttrs: (attrs: Record<string, unknown>) => void;
};

export type EditorNodeContextValue = {
  readOnly: boolean;
  currentBlockId: string;
  onNavigatePage: (pageId: string) => void;
  renderEmbeddedDatabase: (props: EmbeddedDbRenderProps) => React.ReactNode;
};

export const EditorNodeContext = createContext<EditorNodeContextValue>({
  readOnly: false,
  currentBlockId: "",
  onNavigatePage: () => {},
  renderEmbeddedDatabase: () => null,
});

const CALLOUT_COLORS = [
  { id: "gray", hex: "#e5e7eb" },
  { id: "blue", hex: "#bfdbfe" },
  { id: "green", hex: "#bbf7d0" },
  { id: "yellow", hex: "#fef08a" },
  { id: "red", hex: "#fecaca" },
  { id: "purple", hex: "#e9d5ff" },
] as const;

function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const { readOnly } = useContext(EditorNodeContext);
  const [showEmoji, setShowEmoji] = useState(false);
  const icon = (node.attrs.icon as string) || "💡";
  const color = (node.attrs.color as string) || "gray";

  return (
    <NodeViewWrapper
      className={`${styles.calloutWrapper} ${styles[`callout_${color}`] || styles.callout_gray}`}
    >
      <button
        type="button"
        contentEditable={false}
        className={styles.calloutIconBtn}
        onClick={() => {
          if (!readOnly) setShowEmoji((p) => !p);
        }}
        title={readOnly ? undefined : "Change callout icon"}
      >
        {icon}
      </button>

      {showEmoji && !readOnly && (
        <div className={styles.calloutEmojiPopover} contentEditable={false}>
          <EmojiPicker
            onSelect={(next) => {
              updateAttributes({ icon: next });
              setShowEmoji(false);
            }}
          />
        </div>
      )}

      <div className={styles.calloutBody}>
        <NodeViewContent />
      </div>

      {!readOnly && (
        <div className={styles.calloutControls} contentEditable={false}>
          {CALLOUT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.colorDot}
              style={{ background: c.hex }}
              title={`Color: ${c.id}`}
              onClick={() => updateAttributes({ color: c.id })}
            />
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const CalloutExtension = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      icon: { default: "💡" },
      color: { default: "gray" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});

function ColumnsNodeView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const { readOnly } = useContext(EditorNodeContext);
  const columnCount = node.childCount;

  const handleAddColumn = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null) return;
    const endPos = pos + node.nodeSize - 1;
    editor
      .chain()
      .focus()
      .insertContentAt(endPos, {
        type: "column",
        content: [{ type: "paragraph" }],
      })
      .run();
  };

  return (
    <NodeViewWrapper className={styles.columnsWrapper}>
      {!readOnly && (
        <div className={styles.columnsControls} contentEditable={false}>
          {columnCount < 4 && (
            <button
              type="button"
              className={styles.smallActionBtn}
              onClick={handleAddColumn}
            >
              <Plus size={11} />
              <span>Add column</span>
            </button>
          )}
          <button
            type="button"
            className={styles.smallActionBtn}
            onClick={() => deleteNode()}
          >
            <Trash2 size={11} />
            <span>Remove columns</span>
          </button>
        </div>
      )}
      <NodeViewContent className={styles.columnsGrid} />
    </NodeViewWrapper>
  );
}

export const ColumnExtension = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "column",
        class: styles.columnCell,
      }),
      0,
    ];
  },
});

export const ColumnsExtension = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsNodeView);
  },
});

function ImageBlockNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const { readOnly } = useContext(EditorNodeContext);
  const src = (node.attrs.src as string | null) || null;
  const caption = (node.attrs.caption as string) || "";
  const width = (node.attrs.width as string) || "100%";
  const resolvedUrl = useMediaUrl(src);
  const [urlInput, setUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    const saved = await saveMediaFile(file, file.name);
    updateAttributes({ src: saved.url, alt: file.name });
  };

  return (
    <NodeViewWrapper className={styles.mediaCard} contentEditable={false}>
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
      )}

      {!src ? (
        <div className={styles.mediaUploadBox}>
          <ImageIcon size={24} />
          <div>Upload an image or paste an image URL</div>
          {!readOnly && (
            <>
              <div className={styles.mediaUploadActions}>
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} />
                  <span>Choose image</span>
                </button>
                <button
                  type="button"
                  className={styles.smallActionBtn}
                  onClick={() => deleteNode()}
                >
                  Cancel
                </button>
              </div>
              <div className={styles.urlInputRow}>
                <input
                  className={styles.urlInput}
                  placeholder="https://example.com/image.png"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      updateAttributes({ src: urlInput.trim() });
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.smallActionBtn}
                  onClick={() => {
                    if (urlInput.trim()) updateAttributes({ src: urlInput.trim() });
                  }}
                >
                  Embed
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div>
          {!readOnly && (
            <div className={styles.mediaToolbar}>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() =>
                  updateAttributes({ width: width === "100%" ? "65%" : "100%" })
                }
              >
                {width === "100%" ? "Medium" : "Full"}
              </button>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => deleteNode()}
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
          {resolvedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedUrl}
              alt={(node.attrs.alt as string) || caption || "Uploaded image"}
              className={styles.imagePreview}
              style={{ width }}
            />
          ) : (
            <div className={styles.fileMeta}>Loading image...</div>
          )}
          <input
            className={styles.captionInput}
            placeholder={readOnly ? "" : "Write a caption..."}
            value={caption}
            readOnly={readOnly}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ImageBlockExtension = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      caption: { default: "" },
      width: { default: "100%" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "image-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockNodeView);
  },
});

function VideoBlockNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const { readOnly } = useContext(EditorNodeContext);
  const src = (node.attrs.src as string | null) || null;
  const fileName = (node.attrs.fileName as string) || "";
  const caption = (node.attrs.caption as string) || "";
  const resolvedUrl = useMediaUrl(src);
  const [urlInput, setUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    const saved = await saveMediaFile(file, file.name);
    updateAttributes({ src: saved.url, fileName: file.name });
  };

  return (
    <NodeViewWrapper className={styles.mediaCard} contentEditable={false}>
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
      )}

      {!src ? (
        <div className={styles.mediaUploadBox}>
          <Film size={24} />
          <div>Upload a video file (.mp4, .webm, .mov) or paste a video URL</div>
          {!readOnly && (
            <>
              <div className={styles.mediaUploadActions}>
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} />
                  <span>Choose video</span>
                </button>
                <button
                  type="button"
                  className={styles.smallActionBtn}
                  onClick={() => deleteNode()}
                >
                  Cancel
                </button>
              </div>
              <div className={styles.urlInputRow}>
                <input
                  className={styles.urlInput}
                  placeholder="https://example.com/video.mp4"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      updateAttributes({ src: urlInput.trim(), fileName: "Video" });
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.smallActionBtn}
                  onClick={() => {
                    if (urlInput.trim()) {
                      updateAttributes({ src: urlInput.trim(), fileName: "Video" });
                    }
                  }}
                >
                  Embed
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div>
          {!readOnly && (
            <div className={styles.mediaToolbar}>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                Replace video
              </button>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => deleteNode()}
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
          {resolvedUrl ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={resolvedUrl}
              className={styles.videoPreview}
            />
          ) : (
            <div className={styles.fileMeta}>Loading video...</div>
          )}
          <input
            className={styles.captionInput}
            placeholder={readOnly ? "" : fileName || "Video caption..."}
            value={caption}
            readOnly={readOnly}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const VideoBlockExtension = Node.create({
  name: "videoBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      fileName: { default: "" },
      caption: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="video-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "video-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockNodeView);
  },
});

function FileBlockNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const { readOnly } = useContext(EditorNodeContext);
  const src = (node.attrs.src as string | null) || null;
  const fileName = (node.attrs.fileName as string) || "Attachment";
  const fileSize = (node.attrs.fileSize as number) || 0;
  const resolvedUrl = useMediaUrl(src);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    const saved = await saveMediaFile(file, file.name);
    updateAttributes({
      src: saved.url,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  };

  return (
    <NodeViewWrapper className={styles.mediaCard} contentEditable={false}>
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
      )}

      {!src ? (
        <div className={styles.mediaUploadBox}>
          <FileText size={24} />
          <div>Attach any file (PDF, ZIP, DOCX, CSV...)</div>
          {!readOnly && (
            <div className={styles.mediaUploadActions}>
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} />
                <span>Choose file</span>
              </button>
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => deleteNode()}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.fileRow}>
          <div className={styles.fileInfo}>
            <FileText size={20} />
            <div style={{ minWidth: 0 }}>
              <div className={styles.fileName}>{fileName}</div>
              <div className={styles.fileMeta}>{formatFileSize(fileSize)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                download={fileName}
                className={styles.downloadLink}
              >
                <Download size={13} />
                <span>Download</span>
              </a>
            )}
            {!readOnly && (
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => deleteNode()}
                title="Remove file"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const FileBlockExtension = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      fileName: { default: "Attachment" },
      fileSize: { default: 0 },
      mimeType: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="file-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "file-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockNodeView);
  },
});

function PageMentionNodeView({ node }: NodeViewProps) {
  const { onNavigatePage } = useContext(EditorNodeContext);
  const { blocks } = useWorkspace();
  const pageId = (node.attrs.pageId as string) || "";
  const target = blocks[pageId];
  const title = target?.title || (node.attrs.fallbackTitle as string) || "Untitled";
  const icon = target?.icon || (node.attrs.fallbackIcon as string) || "📄";

  return (
    <NodeViewWrapper
      as="span"
      className={styles.pageMention}
      contentEditable={false}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (pageId) onNavigatePage(pageId);
      }}
      title={`Open ${title}`}
    >
      <span>{icon}</span>
      <span>{title}</span>
    </NodeViewWrapper>
  );
}

export const PageMentionExtension = Node.create({
  name: "pageMention",
  inline: true,
  group: "inline",
  atom: true,

  addAttributes() {
    return {
      pageId: { default: "" },
      fallbackTitle: { default: "Untitled" },
      fallbackIcon: { default: "📄" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="page-mention"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "page-mention" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageMentionNodeView);
  },
});

function DatabaseViewNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const { readOnly, currentBlockId, renderEmbeddedDatabase } = useContext(EditorNodeContext);
  const { blocks, createDatabase } = useWorkspace();
  const databaseId = (node.attrs.databaseId as string | null) || null;
  const viewId = (node.attrs.viewId as string | null) || null;
  const filterRules = (node.attrs.filterRules as ViewFilterRule[] | null) || null;

  const databases = Object.values(blocks).filter(
    (b) => b.type === "database" && !b.isArchived
  );
  const selectedDb = databaseId ? blocks[databaseId] : null;

  return (
    <NodeViewWrapper className={styles.embeddedDbWrapper} contentEditable={false}>
      <div className={styles.embeddedDbHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Table2 size={14} />
          <span>{selectedDb ? `${selectedDb.icon || "📊"} ${selectedDb.title}` : "Linked Database View"}</span>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {selectedDb && (
              <button
                type="button"
                className={styles.smallActionBtn}
                onClick={() => updateAttributes({ databaseId: null, viewId: null })}
              >
                Switch DB
              </button>
            )}
            <button
              type="button"
              className={styles.smallActionBtn}
              onClick={() => deleteNode()}
              title="Remove database view"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {!selectedDb ? (
        <div className={styles.embeddedDbPicker}>
          <select
            className={styles.dbSelect}
            value=""
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value) {
                updateAttributes({ databaseId: e.target.value, viewId: null });
              }
            }}
          >
            <option value="">Select a database to embed...</option>
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.icon || "📊"} {db.title || "Untitled Database"}
              </option>
            ))}
          </select>
          {!readOnly && (
            <button
              type="button"
              className={styles.smallActionBtn}
              onClick={() => {
                const db = createDatabase("Inline Database", currentBlockId || undefined);
                updateAttributes({ databaseId: db.id, viewId: null });
              }}
            >
              <Plus size={12} />
              <span>Create new database</span>
            </button>
          )}
        </div>
      ) : (
        renderEmbeddedDatabase({
          databaseId: selectedDb.id,
          viewId,
          filterRules,
          currentPageId: currentBlockId,
          readOnly,
          onUpdateNodeAttrs: updateAttributes,
        })
      )}
    </NodeViewWrapper>
  );
}

export const DatabaseViewExtension = Node.create({
  name: "databaseView",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      databaseId: { default: null },
      viewId: { default: null },
      filterRules: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database-view"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "database-view" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseViewNodeView);
  },
});
