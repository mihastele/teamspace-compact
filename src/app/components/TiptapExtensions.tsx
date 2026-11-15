"use client";

import React, { createContext, useContext, useRef, useState, useEffect } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useWorkspace } from "@/lib/workspace-store";
import {
  formatFileSize,
  saveMediaFile,
  deleteMediaFile,
  useMediaUrl,
  primeMediaUrlCache,
  invalidateMediaUrlCache,
} from "@/lib/media-store";
import {
  storeLocalMedia,
  getLocalMediaBlob,
  deleteLocalMedia,
  markLocalUploadInFlight,
  clearLocalUploadInFlight,
  isLocalUploadInFlight,
} from "@/lib/attachments";
import { safeUUID } from "@/lib/collaboration-model";
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
  onUploadMediaFile?: (file: File) => Promise<{ url: string; attachmentId?: string }>;
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
  const icon = (node.attrs.icon as string | null) || null;
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
        title={readOnly ? undefined : icon ? "Change or remove callout icon" : "Add callout icon"}
      >
        {icon || "💡"}
      </button>

      {showEmoji && !readOnly && (
        <div className={styles.calloutEmojiPopover} contentEditable={false}>
          <EmojiPicker
            onSelect={(next) => {
              updateAttributes({ icon: next });
              setShowEmoji(false);
            }}
            onRemove={() => {
              updateAttributes({ icon: null });
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
  const { workspace } = useWorkspace();
  const { readOnly, onUploadMediaFile } = useContext(EditorNodeContext);
  const rawSrc = (node.attrs.src as string | null) || (node.attrs.url as string | null) || null;
  const attachmentId = node.attrs.attachmentId as string | undefined;
  const isStaleBlob = Boolean(rawSrc?.startsWith("blob:") && attachmentId && !attachmentId.startsWith("local-"));
  const fallbackServerUrl = isStaleBlob && workspace?.id ? `/api/workspaces/${workspace.id}/attachments/${attachmentId}/inline` : null;
  const src = isStaleBlob ? fallbackServerUrl : rawSrc;
  const caption = (node.attrs.caption as string) || "";
  const width = (node.attrs.width as string) || "100%";
  const resolvedUrl = useMediaUrl(src);
  const [urlInput, setUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isStaleBlob && fallbackServerUrl) {
      updateAttributes({ src: fallbackServerUrl, url: fallbackServerUrl });
    }
  }, [isStaleBlob, fallbackServerUrl, updateAttributes]);

  const handleUpload = async (file: File) => {
    if (onUploadMediaFile) {
      const res = await onUploadMediaFile(file);
      updateAttributes({ src: res.url, url: res.url, attachmentId: res.attachmentId, alt: file.name });
    } else {
      const saved = await saveMediaFile(file, file.name);
      updateAttributes({ src: saved.url, alt: file.name });
    }
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
      blockId: { default: null },
      attachmentId: { default: null },
      url: { default: null },
      src: { default: null },
      originalName: { default: null },
      contentType: { default: "image/png" },
      bytes: { default: 0 },
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
  const { workspace } = useWorkspace();
  const { readOnly, onUploadMediaFile } = useContext(EditorNodeContext);
  const rawSrc = (node.attrs.src as string | null) || (node.attrs.url as string | null) || null;
  const attachmentId = (node.attrs.attachmentId as string | null) || undefined;
  const isStaleBlobWithServerId = Boolean(
    rawSrc?.startsWith("blob:") && attachmentId && !attachmentId.startsWith("local-")
  );
  const isOrphanBlob = Boolean(rawSrc?.startsWith("blob:") && !attachmentId);
  const fallbackServerUrl =
    isStaleBlobWithServerId && workspace?.id
      ? `/api/workspaces/${workspace.id}/attachments/${attachmentId}/inline`
      : null;
  const src = isStaleBlobWithServerId
    ? fallbackServerUrl
    : rawSrc?.startsWith("blob:") && attachmentId?.startsWith("local-")
    ? attachmentId
    : rawSrc;
  const fileName = (node.attrs.fileName as string) || (node.attrs.originalName as string) || "";
  const caption = (node.attrs.caption as string) || "";
  const resolvedUrl = useMediaUrl(src);
  const [urlInput, setUrlInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const retriedSignedUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isStaleBlobWithServerId && fallbackServerUrl) {
      updateAttributes({ src: fallbackServerUrl, url: fallbackServerUrl });
    }
  }, [isStaleBlobWithServerId, fallbackServerUrl, updateAttributes]);

  // If the page was refreshed while a local video upload was pending, resume it automatically
  useEffect(() => {
    const localKey =
      attachmentId?.startsWith("local-")
        ? attachmentId
        : rawSrc?.startsWith("local-")
        ? rawSrc
        : null;
    if (!localKey || !onUploadMediaFile || isLocalUploadInFlight(localKey)) return;

    let cancelled = false;
    markLocalUploadInFlight(localKey);
    void (async () => {
      try {
        const blob = await getLocalMediaBlob(localKey);
        if (!blob || cancelled) return;
        setIsUploading(true);
        setUploadError(null);
        const resumedFile = new File(
          [blob],
          fileName || "video.mp4",
          { type: (node.attrs.contentType as string) || blob.type || "video/mp4" }
        );
        const res = await onUploadMediaFile(resumedFile);
        if (cancelled) return;
        updateAttributes({
          src: res.url,
          url: res.url,
          attachmentId: res.attachmentId,
          fileName: resumedFile.name,
          originalName: resumedFile.name,
          contentType: resumedFile.type,
          bytes: resumedFile.size,
        });
        await deleteLocalMedia(localKey);
        await deleteMediaFile(localKey);
      } catch (err) {
        if (!cancelled) {
          setUploadError(err instanceof Error ? err.message : "Upload failed");
        }
      } finally {
        clearLocalUploadInFlight(localKey);
        if (!cancelled) setIsUploading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachmentId, rawSrc, onUploadMediaFile, fileName, node.attrs.contentType, updateAttributes]);

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setVideoLoadError(false);
    if (onUploadMediaFile) {
      const tempId = `local-${safeUUID()}`;
      const tempUrl = URL.createObjectURL(file);
      primeMediaUrlCache(tempId, tempUrl);
      markLocalUploadInFlight(tempId);
      setIsUploading(true);
      try {
        await storeLocalMedia(tempId, file);
        updateAttributes({
          blockId: tempId,
          attachmentId: tempId,
          src: tempId,
          url: tempId,
          fileName: file.name,
          originalName: file.name,
          contentType: file.type,
          bytes: file.size,
        });
        const res = await onUploadMediaFile(file);
        updateAttributes({
          src: res.url,
          url: res.url,
          attachmentId: res.attachmentId,
          fileName: file.name,
          originalName: file.name,
          contentType: file.type,
          bytes: file.size,
        });
        // Videos are not stored permanently in browser IndexedDB once uploaded to server
        await deleteLocalMedia(tempId);
        await deleteMediaFile(tempId);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Video upload failed.");
      } finally {
        clearLocalUploadInFlight(tempId);
        setIsUploading(false);
      }
    } else {
      const saved = await saveMediaFile(file, file.name);
      updateAttributes({
        src: saved.url,
        url: saved.url,
        attachmentId: saved.meta.id,
        fileName: file.name,
        originalName: file.name,
        contentType: file.type,
        bytes: file.size,
      });
    }
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

      {!src || isOrphanBlob || videoLoadError ? (
        <div className={styles.mediaUploadBox}>
          <Film size={24} />
          <div>
            {uploadError
              ? `Upload error: ${uploadError}`
              : isOrphanBlob || videoLoadError
              ? "Video file is unavailable or did not finish uploading. Please re-upload."
              : "Upload a video file (.mp4, .webm, .mov) or paste a video URL"}
          </div>
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
                      setVideoLoadError(false);
                      updateAttributes({ src: urlInput.trim(), url: urlInput.trim(), fileName: "Video" });
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.smallActionBtn}
                  onClick={() => {
                    if (urlInput.trim()) {
                      setVideoLoadError(false);
                      updateAttributes({ src: urlInput.trim(), url: urlInput.trim(), fileName: "Video" });
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
                {isUploading ? "Uploading..." : "Replace video"}
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
          {uploadError && (
            <div className={styles.fileMeta} style={{ color: "#dc2626", marginBottom: 6 }}>
              {uploadError}
            </div>
          )}
          {resolvedUrl ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={resolvedUrl}
              className={styles.videoPreview}
              onError={() => {
                if (src?.startsWith("/api/") && retriedSignedUrlRef.current !== src) {
                  retriedSignedUrlRef.current = src;
                  invalidateMediaUrlCache(src);
                  return;
                }
                if (rawSrc?.startsWith("blob:")) {
                  setVideoLoadError(true);
                }
              }}
            />
          ) : (
            <div className={styles.fileMeta}>
              {isUploading ? "Uploading video to server..." : "Loading video..."}
            </div>
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
      blockId: { default: null },
      attachmentId: { default: null },
      url: { default: null },
      src: { default: null },
      fileName: { default: "" },
      originalName: { default: null },
      contentType: { default: "video/mp4" },
      bytes: { default: 0 },
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
  const { readOnly, onUploadMediaFile } = useContext(EditorNodeContext);
  const src = (node.attrs.src as string | null) || (node.attrs.url as string | null) || null;
  const fileName = (node.attrs.fileName as string) || (node.attrs.originalName as string) || "Attachment";
  const fileSize = (node.attrs.fileSize as number) || (node.attrs.bytes as number) || 0;
  const resolvedUrl = useMediaUrl(src);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (onUploadMediaFile) {
      const tempId = `local-${safeUUID()}`;
      const tempUrl = URL.createObjectURL(file);
      primeMediaUrlCache(tempId, tempUrl);
      markLocalUploadInFlight(tempId);
      try {
        await storeLocalMedia(tempId, file);
        updateAttributes({
          blockId: tempId,
          attachmentId: tempId,
          src: tempId,
          url: tempId,
          fileName: file.name,
          originalName: file.name,
          fileSize: file.size,
          bytes: file.size,
          mimeType: file.type,
          contentType: file.type,
        });
        const res = await onUploadMediaFile(file);
        updateAttributes({
          src: res.url,
          url: res.url,
          attachmentId: res.attachmentId,
          fileName: file.name,
          originalName: file.name,
          fileSize: file.size,
          bytes: file.size,
          mimeType: file.type,
          contentType: file.type,
        });
        // Documents are NOT kept permanently in browser storage once uploaded
        await deleteLocalMedia(tempId);
        await deleteMediaFile(tempId);
      } finally {
        clearLocalUploadInFlight(tempId);
      }
    } else {
      const saved = await saveMediaFile(file, file.name);
      updateAttributes({
        src: saved.url,
        url: saved.url,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });
    }
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
      blockId: { default: null },
      attachmentId: { default: null },
      url: { default: null },
      src: { default: null },
      fileName: { default: "Attachment" },
      originalName: { default: null },
      fileSize: { default: 0 },
      bytes: { default: 0 },
      mimeType: { default: "" },
      contentType: { default: "" },
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
