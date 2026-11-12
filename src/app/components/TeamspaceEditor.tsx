"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useWorkspace } from "@/lib/workspace-store";
import { saveMediaFile, useMediaUrl } from "@/lib/media-store";
import type { Block } from "@/lib/model";
import DatabaseEntryProperties from "./DatabaseEntryProperties";
import DatabaseView from "./DatabaseView";
import { EmojiPicker } from "./EmojiPicker";
import {
  CalloutExtension,
  ColumnExtension,
  ColumnsExtension,
  DatabaseViewExtension,
  EditorNodeContext,
  FileBlockExtension,
  ImageBlockExtension,
  PageMentionExtension,
  VideoBlockExtension,
  type EmbeddedDbRenderProps,
} from "./TiptapExtensions";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Quote,
  Minus,
  Smile,
  Image as ImageIcon,
  MessageSquareQuote,
  Columns2,
  Columns3,
  Film,
  FileText,
  Table2,
  Link2,
} from "lucide-react";
import styles from "./TeamspaceEditor.module.css";

const COVER_PRESETS = [
  "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(135deg, #a6c0fe 0%, #f68084 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
  "linear-gradient(135deg, #2b5876 0%, #4e4376 100%)",
  "linear-gradient(135deg, #373b44 0%, #4286f4 100%)",
];

export type TeamspaceEditorProps = {
  block: Block;
  readOnly?: boolean;
  onBlockChange?: (updates: Partial<Block>) => void;
  hideProperties?: boolean;
  onNavigatePage?: (pageId: string) => void;
};

export default function TeamspaceEditor({
  block,
  readOnly = false,
  onBlockChange,
  hideProperties = false,
  onNavigatePage,
}: TeamspaceEditorProps) {
  const { blocks, updateBlock, setActiveBlock } = useWorkspace();
  const [title, setTitle] = useState(block.title);
  const [prevBlockTitle, setPrevBlockTitle] = useState(block.title);
  const [prevBlockId, setPrevBlockId] = useState(block.id);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [coverTab, setCoverTab] = useState<"gallery" | "upload" | "link">("gallery");
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const [mentionMenuPosition, setMentionMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionTriggerChar, setMentionTriggerChar] = useState<"@" | "/">("@");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const coverPickerRef = useRef<HTMLDivElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const resolvedCoverUrl = useMediaUrl(block.coverUrl);

  const applyBlockChange = useCallback(
    (updates: Partial<Block>) => {
      if (readOnly) return;
      if (onBlockChange) {
        onBlockChange(updates);
      } else {
        updateBlock(block.id, updates);
      }
    },
    [readOnly, onBlockChange, updateBlock, block.id]
  );

  // Sync title during render when block changes externally without triggering an effect setState
  if (block.id !== prevBlockId || block.title !== prevBlockTitle) {
    setPrevBlockId(block.id);
    setPrevBlockTitle(block.title);
    setTitle(block.title);
  }

  const mentionablePages = useMemo(() => {
    const q = mentionFilter.trim().toLowerCase();
    return Object.values(blocks)
      .filter(
        (b) =>
          !b.isArchived &&
          b.id !== block.id &&
          (b.type === "page" || b.type === "database") &&
          (!q || (b.title || "Untitled").toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [blocks, block.id, mentionFilter]);

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: readOnly ? "" : "Type '/' for commands, '@' to link a page...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CalloutExtension,
      ColumnExtension,
      ColumnsExtension,
      ImageBlockExtension,
      VideoBlockExtension,
      FileBlockExtension,
      PageMentionExtension,
      DatabaseViewExtension,
    ],
    content: (block.content as JSONContent) || {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    onUpdate: ({ editor: ed }) => {
      if (readOnly) return;
      const json = ed.getJSON();
      applyBlockChange({ content: json });

      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(Math.max(0, from - 24), from);
      const slashMatch = textBefore.match(/\/([a-zA-Z0-9 ]*)$/);
      const mentionMatch = textBefore.match(/@([a-zA-Z0-9 _-]*)$/);

      if (slashMatch) {
        setSlashFilter(slashMatch[1]);
        setSelectedSlashIndex(0);
        const coords = ed.view.coordsAtPos(from);
        setSlashMenuPosition({ x: coords.left, y: coords.bottom + 6 });
        setMentionMenuPosition(null);
      } else if (mentionMatch) {
        setMentionFilter(mentionMatch[1]);
        setMentionTriggerChar("@");
        setSelectedMentionIndex(0);
        const coords = ed.view.coordsAtPos(from);
        setMentionMenuPosition({ x: coords.left, y: coords.bottom + 6 });
        setSlashMenuPosition(null);
      } else {
        setSlashMenuPosition(null);
        setMentionMenuPosition(null);
      }
    },
    editorProps: {
      handleDrop: (_view, event) => {
        if (readOnly) return false;
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const file = files[0];
        event.preventDefault();
        void saveMediaFile(file, file.name).then((saved) => {
          if (!editor) return;
          if (file.type.startsWith("image/")) {
            editor.chain().focus().insertContent({
              type: "imageBlock",
              attrs: { src: saved.url, alt: file.name },
            }).run();
          } else if (file.type.startsWith("video/")) {
            editor.chain().focus().insertContent({
              type: "videoBlock",
              attrs: { src: saved.url, fileName: file.name },
            }).run();
          } else {
            editor.chain().focus().insertContent({
              type: "fileBlock",
              attrs: {
                src: saved.url,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
              },
            }).run();
          }
        });
        return true;
      },
      handleKeyDown: (_view, event) => {
        const mentionState = mentionStateRef.current;
        if (mentionState.isOpen && mentionState.pages.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedMentionIndex((prev) => (prev + 1) % mentionState.pages.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedMentionIndex(
              (prev) => (prev - 1 + mentionState.pages.length) % mentionState.pages.length
            );
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const target = mentionState.pages[mentionState.selectedIndex] || mentionState.pages[0];
            if (target) mentionState.select(target);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setMentionMenuPosition(null);
            return true;
          }
        }

        const state = slashStateRef.current;
        if (state.isOpen && state.commands.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedSlashIndex((prev) => (prev + 1) % state.commands.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedSlashIndex((prev) => (prev - 1 + state.commands.length) % state.commands.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const cmd = state.commands[state.selectedIndex] || state.commands[0];
            if (cmd) {
              state.execute(cmd.action);
            }
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setSlashMenuPosition(null);
            return true;
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  const insertPageMention = useCallback(
    (target: Block) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      if (mentionTriggerChar === "@") {
        const deleteCount = mentionFilter.length + 1;
        editor.commands.deleteRange({ from: Math.max(0, from - deleteCount), to: from });
      }
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "pageMention",
            attrs: {
              pageId: target.id,
              fallbackTitle: target.title || "Untitled",
              fallbackIcon: target.icon || "📄",
            },
          },
          { type: "text", text: " " },
        ])
        .run();
      setMentionMenuPosition(null);
    },
    [editor, mentionFilter, mentionTriggerChar]
  );

  const slashCommands = useMemo(
    () =>
      [
        {
          title: "Heading 1",
          icon: <Heading1 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleHeading({ level: 1 }).run(),
        },
        {
          title: "Heading 2",
          icon: <Heading2 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          title: "Heading 3",
          icon: <Heading3 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleHeading({ level: 3 }).run(),
        },
        {
          title: "To-do List",
          icon: <CheckSquare size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleTaskList().run(),
        },
        {
          title: "Bullet List",
          icon: <List size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleBulletList().run(),
        },
        {
          title: "Numbered List",
          icon: <ListOrdered size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleOrderedList().run(),
        },
        {
          title: "Callout",
          icon: <MessageSquareQuote size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "callout",
                attrs: { icon: "💡", color: "blue" },
                content: [{ type: "paragraph" }],
              })
              .run(),
        },
        {
          title: "2 Columns",
          icon: <Columns2 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "columns",
                content: [
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                ],
              })
              .run(),
        },
        {
          title: "3 Columns",
          icon: <Columns3 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "columns",
                content: [
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                ],
              })
              .run(),
        },
        {
          title: "Database View",
          icon: <Table2 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "databaseView",
                attrs: { databaseId: null, viewId: null, filterRules: null },
              })
              .run(),
        },
        {
          title: "Image",
          icon: <ImageIcon size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "imageBlock",
                attrs: { src: null },
              })
              .run(),
        },
        {
          title: "Video",
          icon: <Film size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "videoBlock",
                attrs: { src: null },
              })
              .run(),
        },
        {
          title: "File",
          icon: <FileText size={15} />,
          action: (ed: ReturnType<typeof useEditor>) =>
            ed
              ?.chain()
              .focus()
              .insertContent({
                type: "fileBlock",
                attrs: { src: null },
              })
              .run(),
        },
        {
          title: "Page Reference",
          icon: <Link2 size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => {
            if (!ed) return;
            const coords = ed.view.coordsAtPos(ed.state.selection.from);
            setMentionFilter("");
            setMentionTriggerChar("/");
            setSelectedMentionIndex(0);
            setMentionMenuPosition({ x: coords.left, y: coords.bottom + 6 });
          },
        },
        {
          title: "Quote",
          icon: <Quote size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleBlockquote().run(),
        },
        {
          title: "Code Block",
          icon: <Code size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().toggleCodeBlock().run(),
        },
        {
          title: "Divider",
          icon: <Minus size={15} />,
          action: (ed: ReturnType<typeof useEditor>) => ed?.chain().focus().setHorizontalRule().run(),
        },
      ].filter((c) => c.title.toLowerCase().includes(slashFilter.toLowerCase())),
    [slashFilter]
  );

  const executeSlashCommand = useCallback(
    (action: (ed: ReturnType<typeof useEditor>) => void) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const deleteCount = slashFilter.length + 1;
      editor.commands.deleteRange({ from: Math.max(0, from - deleteCount), to: from });
      action(editor);
      setSlashMenuPosition(null);
      editor.commands.focus();
    },
    [editor, slashFilter]
  );

  const slashStateRef = useRef({
    isOpen: false,
    commands: slashCommands,
    selectedIndex: 0,
    execute: executeSlashCommand,
  });

  useEffect(() => {
    slashStateRef.current = {
      isOpen: slashMenuPosition !== null,
      commands: slashCommands,
      selectedIndex: selectedSlashIndex,
      execute: executeSlashCommand,
    };
  }, [slashMenuPosition, slashCommands, selectedSlashIndex, executeSlashCommand]);

  const mentionStateRef = useRef({
    isOpen: false,
    pages: mentionablePages,
    selectedIndex: 0,
    select: insertPageMention,
  });

  useEffect(() => {
    mentionStateRef.current = {
      isOpen: mentionMenuPosition !== null,
      pages: mentionablePages,
      selectedIndex: selectedMentionIndex,
      select: insertPageMention,
    };
  }, [mentionMenuPosition, mentionablePages, selectedMentionIndex, insertPageMention]);

  // Re-sync editor content only when unfocused and content externally differs
  useEffect(() => {
    if (editor && !editor.isFocused && block.content) {
      const currentJson = editor.getJSON();
      if (JSON.stringify(currentJson) !== JSON.stringify(block.content)) {
        editor.commands.setContent(block.content as JSONContent, { emitUpdate: false });
      }
    }
  }, [block.id, block.content, editor]);

  // Click-outside listener to dismiss popovers
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showCoverPicker && coverPickerRef.current && !coverPickerRef.current.contains(target)) {
        setShowCoverPicker(false);
      }
      if (showEmojiPicker && emojiPickerRef.current && !emojiPickerRef.current.contains(target)) {
        setShowEmojiPicker(false);
      }
      if (slashMenuPosition && slashMenuRef.current && !slashMenuRef.current.contains(target)) {
        setSlashMenuPosition(null);
      }
      if (mentionMenuPosition && mentionMenuRef.current && !mentionMenuRef.current.contains(target)) {
        setMentionMenuPosition(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowEmojiPicker(false);
        setShowCoverPicker(false);
        setSlashMenuPosition(null);
        setMentionMenuPosition(null);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showEmojiPicker, showCoverPicker, slashMenuPosition, mentionMenuPosition]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const nextTitle = e.target.value;
    setTitle(nextTitle);
    applyBlockChange({ title: nextTitle });
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.commands.focus("start");
    }
  };

  const handleCoverUpload = async (file: File) => {
    const saved = await saveMediaFile(file, file.name);
    applyBlockChange({ coverUrl: saved.url });
    setShowCoverPicker(false);
  };

  const isDatabaseEntry =
    !hideProperties && Boolean(block.parentId && blocks[block.parentId]?.type === "database");

  const renderEmbeddedDatabase = useCallback(
    (props: EmbeddedDbRenderProps) => {
      const dbBlock = blocks[props.databaseId];
      if (!dbBlock) return null;
      return (
        <DatabaseView
          block={dbBlock}
          embedded
          readOnly={props.readOnly}
          initialViewId={props.viewId || undefined}
          overrideFilters={props.filterRules || undefined}
          currentPageId={props.currentPageId}
          onOverrideFiltersChange={(nextRules) =>
            props.onUpdateNodeAttrs({ filterRules: nextRules })
          }
        />
      );
    },
    [blocks]
  );

  const editorContextValue = useMemo(
    () => ({
      readOnly,
      currentBlockId: block.id,
      onNavigatePage: (pageId: string) => {
        if (onNavigatePage) {
          onNavigatePage(pageId);
        } else {
          setActiveBlock(pageId);
        }
      },
      renderEmbeddedDatabase,
    }),
    [readOnly, block.id, onNavigatePage, setActiveBlock, renderEmbeddedDatabase]
  );

  const coverBackground = useMemo(() => {
    if (!block.coverUrl) return undefined;
    if (block.coverUrl.startsWith("linear-gradient")) return block.coverUrl;
    if (resolvedCoverUrl) return `url("${resolvedCoverUrl}") center/cover no-repeat`;
    return undefined;
  }, [block.coverUrl, resolvedCoverUrl]);

  return (
    <EditorNodeContext.Provider value={editorContextValue}>
      <div
        className={`${styles.canvasContainer} ${block.isFullWidth ? styles.canvasFullWidth : ""} ${styles[`font_${block.fontStyle || "sans"}`]}`}
      >
        {/* Cover Image Banner */}
        {block.coverUrl && (
          <div className={styles.coverContainer}>
            <div
              className={styles.coverImage}
              style={{ background: coverBackground }}
            />
            {!readOnly && (
              <div className={styles.coverActions}>
                <button
                  type="button"
                  className={styles.coverBtn}
                  onClick={() => setShowCoverPicker((prev) => !prev)}
                >
                  Change cover
                </button>
                <button
                  type="button"
                  className={styles.coverBtn}
                  onClick={() => applyBlockChange({ coverUrl: null })}
                >
                  Remove
                </button>
              </div>
            )}
            {showCoverPicker && !readOnly && (
              <div ref={coverPickerRef} className={styles.coverGalleryPopover}>
                <div className={styles.coverTabs}>
                  <button
                    type="button"
                    className={`${styles.coverTab} ${coverTab === "gallery" ? styles.coverTabActive : ""}`}
                    onClick={() => setCoverTab("gallery")}
                  >
                    Gallery
                  </button>
                  <button
                    type="button"
                    className={`${styles.coverTab} ${coverTab === "upload" ? styles.coverTabActive : ""}`}
                    onClick={() => setCoverTab("upload")}
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    className={`${styles.coverTab} ${coverTab === "link" ? styles.coverTabActive : ""}`}
                    onClick={() => setCoverTab("link")}
                  >
                    Link
                  </button>
                </div>

                {coverTab === "gallery" && (
                  <div className={styles.coverPresetGrid}>
                    {COVER_PRESETS.map((preset, idx) => (
                      <div
                        key={idx}
                        className={styles.coverPreset}
                        style={{ background: preset }}
                        onClick={() => {
                          applyBlockChange({ coverUrl: preset });
                          setShowCoverPicker(false);
                        }}
                      />
                    ))}
                  </div>
                )}

                {coverTab === "upload" && (
                  <div className={styles.coverUploadArea}>
                    <input
                      ref={coverFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleCoverUpload(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className={styles.coverUploadBtn}
                      onClick={() => coverFileInputRef.current?.click()}
                    >
                      Choose cover image
                    </button>
                  </div>
                )}

                {coverTab === "link" && (
                  <div className={styles.coverUploadArea}>
                    <input
                      className={styles.coverUrlInput}
                      placeholder="Paste image URL (https://...)"
                      value={coverUrlInput}
                      onChange={(e) => setCoverUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && coverUrlInput.trim()) {
                          applyBlockChange({ coverUrl: coverUrlInput.trim() });
                          setShowCoverPicker(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={styles.coverUploadBtn}
                      onClick={() => {
                        if (coverUrlInput.trim()) {
                          applyBlockChange({ coverUrl: coverUrlInput.trim() });
                          setShowCoverPicker(false);
                        }
                      }}
                    >
                      Apply cover URL
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Page Header */}
        <div className={styles.header}>
          {!readOnly && (
            <div className={styles.pageMetadataActions}>
              <button
                type="button"
                className={styles.metaBtn}
                onClick={() => setShowEmojiPicker((prev) => !prev)}
              >
                <Smile size={14} />
                <span>{block.icon ? "Change icon" : "Add icon"}</span>
              </button>
              {!block.coverUrl && (
                <button
                  type="button"
                  className={styles.metaBtn}
                  onClick={() => applyBlockChange({ coverUrl: COVER_PRESETS[0] })}
                >
                  <ImageIcon size={14} />
                  <span>Add cover</span>
                </button>
              )}
            </div>
          )}

          {/* Page Icon Display */}
          {block.icon && (
            <div
              className={styles.pageIcon}
              onClick={() => {
                if (!readOnly) setShowEmojiPicker((prev) => !prev);
              }}
              title={readOnly ? undefined : "Change icon"}
            >
              {block.icon}
            </div>
          )}

          {showEmojiPicker && !readOnly && (
            <div ref={emojiPickerRef} style={{ position: "absolute", zIndex: 70 }}>
              <EmojiPicker
                onSelect={(emoji) => {
                  applyBlockChange({ icon: emoji });
                  setShowEmojiPicker(false);
                }}
                onRemove={() => {
                  applyBlockChange({ icon: null });
                  setShowEmojiPicker(false);
                }}
              />
            </div>
          )}

          {/* Title Input */}
          <input
            ref={titleInputRef}
            className={styles.titleInput}
            placeholder="Untitled"
            value={title}
            readOnly={readOnly}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
          />
        </div>

        {/* If this page is a database entry, show rich properties section */}
        {isDatabaseEntry && <DatabaseEntryProperties row={block} readOnly={readOnly} />}

        {/* Tiptap Block Editor Content */}
        <div className={styles.editorArea}>
          <EditorContent editor={editor} />
        </div>

        {/* Floating Slash Command Menu */}
        {!readOnly && slashMenuPosition && slashCommands.length > 0 && (
          <div
            ref={slashMenuRef}
            className={styles.slashMenu}
            style={{
              top: `${slashMenuPosition.y}px`,
              left: `${slashMenuPosition.x}px`,
            }}
          >
            <div className={styles.slashMenuHeader}>Blocks & Media</div>
            {slashCommands.map((cmd, idx) => (
              <button
                key={cmd.title}
                type="button"
                className={`${styles.slashMenuItem} ${idx === selectedSlashIndex ? styles.slashMenuItemActive : ""}`}
                onMouseEnter={() => setSelectedSlashIndex(idx)}
                onClick={() => executeSlashCommand(cmd.action)}
              >
                <span className={styles.slashMenuIcon}>{cmd.icon}</span>
                <span>{cmd.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Floating @ Page Mention Menu */}
        {!readOnly && mentionMenuPosition && (
          <div
            ref={mentionMenuRef}
            className={styles.slashMenu}
            style={{
              top: `${mentionMenuPosition.y}px`,
              left: `${mentionMenuPosition.x}px`,
            }}
          >
            <div className={styles.slashMenuHeader}>Link to page</div>
            {mentionablePages.length === 0 ? (
              <div className={styles.slashMenuItem} style={{ opacity: 0.6 }}>
                No matching pages
              </div>
            ) : (
              mentionablePages.map((page, idx) => (
                <button
                  key={page.id}
                  type="button"
                  className={`${styles.slashMenuItem} ${idx === selectedMentionIndex ? styles.slashMenuItemActive : ""}`}
                  onMouseEnter={() => setSelectedMentionIndex(idx)}
                  onClick={() => insertPageMention(page)}
                >
                  <span className={styles.slashMenuIcon}>{page.icon || "📄"}</span>
                  <span>{page.title || "Untitled"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </EditorNodeContext.Provider>
  );
}
