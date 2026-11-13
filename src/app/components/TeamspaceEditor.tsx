"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useWorkspace } from "@/lib/workspace-store";
import { useTeamspace } from "@/lib/client";
import { usePageCollaboration } from "@/lib/use-page-collaboration";
import { uploadMediaFile } from "@/lib/attachments";
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
  PageMentionExtension,
  VideoBlockExtension,
  type EmbeddedDbRenderProps,
} from "./TiptapExtensions";
import {
  ImageBlockExtension,
  AttachmentBlockExtension,
  AudioBlockExtension,
} from "./MediaNodes";
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
  Table2,
  Link2,
  Paperclip,
  Mic,
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

type SlashCommand = {
  id: string;
  title: string;
  icon: React.ReactNode;
};

const ALL_SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", title: "Heading 1", icon: <Heading1 size={15} /> },
  { id: "h2", title: "Heading 2", icon: <Heading2 size={15} /> },
  { id: "h3", title: "Heading 3", icon: <Heading3 size={15} /> },
  { id: "todo", title: "To-do List", icon: <CheckSquare size={15} /> },
  { id: "bullet", title: "Bullet List", icon: <List size={15} /> },
  { id: "numbered", title: "Numbered List", icon: <ListOrdered size={15} /> },
  { id: "callout", title: "Callout", icon: <MessageSquareQuote size={15} /> },
  { id: "columns2", title: "2 Columns", icon: <Columns2 size={15} /> },
  { id: "columns3", title: "3 Columns", icon: <Columns3 size={15} /> },
  { id: "databaseView", title: "Database View", icon: <Table2 size={15} /> },
  { id: "image", title: "Image", icon: <ImageIcon size={15} /> },
  { id: "video", title: "Video", icon: <Film size={15} /> },
  { id: "file", title: "File / Attachment", icon: <Paperclip size={15} /> },
  { id: "audio", title: "Record Audio", icon: <Mic size={15} /> },
  { id: "pageMention", title: "Page Reference", icon: <Link2 size={15} /> },
  { id: "quote", title: "Quote", icon: <Quote size={15} /> },
  { id: "code", title: "Code Block", icon: <Code size={15} /> },
  { id: "divider", title: "Divider", icon: <Minus size={15} /> },
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
  const api = useTeamspace();
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
  const [isDragOver, setIsDragOver] = useState(false);

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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolvedCoverUrl = useMediaUrl(block.coverUrl);

  // Real-time CRDT Page Collaboration hook
  const { view: collabView, presenceUsers } = usePageCollaboration(block);

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

  const handleFileUploadRef = useRef<(file: File) => Promise<void>>(() => Promise.resolve());

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: readOnly ? "" : "Type '/' for commands, '@' to link a page…",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CalloutExtension,
      ColumnExtension,
      ColumnsExtension,
      VideoBlockExtension,
      FileBlockExtension,
      PageMentionExtension,
      DatabaseViewExtension,
      ImageBlockExtension,
      AttachmentBlockExtension,
      AudioBlockExtension,
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
        if (files && files.length > 0) {
          event.preventDefault();
          setIsDragOver(false);
          for (let i = 0; i < files.length; i++) {
            void handleFileUploadRef.current(files[i]);
          }
          return true;
        }
        setIsDragOver(false);
        return false;
      },
      handlePaste: (_view, event) => {
        if (readOnly) return false;
        const files = event.clipboardData?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          for (let i = 0; i < files.length; i++) {
            void handleFileUploadRef.current(files[i]);
          }
          return true;
        }
        return false;
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
              state.execute(cmd.id);
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
      if (!editor || readOnly) return;
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
    [editor, readOnly, mentionFilter, mentionTriggerChar]
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!editor || readOnly) return;
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      const tempId = `temp-${Date.now()}`;
      const tempUrl = URL.createObjectURL(file);

      if (isImage) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "imageBlock",
            attrs: {
              blockId: tempId,
              attachmentId: tempId,
              url: tempUrl,
              src: tempUrl,
              originalName: file.name,
              contentType: file.type,
              bytes: file.size,
              width: 100,
            },
          })
          .run();
      } else if (isVideo) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "videoBlock",
            attrs: {
              src: tempUrl,
              fileName: file.name,
            },
          })
          .run();
      } else if (isAudio) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "audioBlock",
            attrs: {
              blockId: tempId,
              attachmentId: tempId,
              url: tempUrl,
              originalName: file.name,
              contentType: file.type,
              bytes: file.size,
            },
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "attachmentBlock",
            attrs: {
              blockId: tempId,
              attachmentId: tempId,
              url: tempUrl,
              originalName: file.name,
              contentType: file.type,
              bytes: file.size,
            },
          })
          .run();
      }

      // Background persistence: Supabase Storage when configured, local media store otherwise
      try {
        if (
          api.configured &&
          api.user &&
          api.workspace &&
          (isImage || isAudio || (!isVideo && file.size <= 25 * 1024 * 1024))
        ) {
          const result = await uploadMediaFile(file, "page", block.id, api);
          const currentJson = editor.getJSON();
          const updateNodeAttrs = (nodes?: JSONContent[]): boolean => {
            if (!nodes) return false;
            for (const n of nodes) {
              if (n.attrs?.blockId === tempId) {
                n.attrs.attachmentId = result.attachmentId;
                n.attrs.url = result.url;
                n.attrs.src = result.url;
                return true;
              }
              if (n.content && updateNodeAttrs(n.content)) return true;
            }
            return false;
          };

          if (updateNodeAttrs(currentJson.content)) {
            editor.commands.setContent(currentJson, { emitUpdate: true });
          }
        } else {
          const saved = await saveMediaFile(file, file.name);
          const currentJson = editor.getJSON();
          const updateNodeAttrs = (nodes?: JSONContent[]): boolean => {
            if (!nodes) return false;
            for (const n of nodes) {
              if (
                n.attrs?.blockId === tempId ||
                (isVideo && n.type === "videoBlock" && n.attrs?.src === tempUrl)
              ) {
                n.attrs.url = saved.url;
                n.attrs.src = saved.url;
                return true;
              }
              if (n.content && updateNodeAttrs(n.content)) return true;
            }
            return false;
          };

          if (updateNodeAttrs(currentJson.content)) {
            editor.commands.setContent(currentJson, { emitUpdate: true });
          }
        }
      } catch (err) {
        console.warn("Media upload background sync notice", err);
      }
    },
    [editor, readOnly, block.id, api]
  );

  useEffect(() => {
    handleFileUploadRef.current = handleFileUpload;
  }, [handleFileUpload]);

  const slashCommands = useMemo(
    () =>
      ALL_SLASH_COMMANDS.filter((c) =>
        c.title.toLowerCase().includes(slashFilter.toLowerCase())
      ),
    [slashFilter]
  );

  const executeSlashCommand = useCallback(
    (cmdId: string) => {
      if (!editor || readOnly) return;
      const { from } = editor.state.selection;
      const deleteCount = slashFilter.length + 1;
      editor.commands.deleteRange({ from: Math.max(0, from - deleteCount), to: from });
      setSlashMenuPosition(null);
      editor.commands.focus();

      switch (cmdId) {
        case "h1":
          editor.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case "h2":
          editor.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case "h3":
          editor.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        case "todo":
          editor.chain().focus().toggleTaskList().run();
          break;
        case "bullet":
          editor.chain().focus().toggleBulletList().run();
          break;
        case "numbered":
          editor.chain().focus().toggleOrderedList().run();
          break;
        case "callout":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "callout",
              attrs: { icon: "💡", color: "blue" },
              content: [{ type: "paragraph" }],
            })
            .run();
          break;
        case "columns2":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "columns",
              content: [
                { type: "column", content: [{ type: "paragraph" }] },
                { type: "column", content: [{ type: "paragraph" }] },
              ],
            })
            .run();
          break;
        case "columns3":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "columns",
              content: [
                { type: "column", content: [{ type: "paragraph" }] },
                { type: "column", content: [{ type: "paragraph" }] },
                { type: "column", content: [{ type: "paragraph" }] },
              ],
            })
            .run();
          break;
        case "databaseView":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "databaseView",
              attrs: { databaseId: null, viewId: null, filterRules: null },
            })
            .run();
          break;
        case "image":
          imageInputRef.current?.click();
          break;
        case "video":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "videoBlock",
              attrs: { src: null },
            })
            .run();
          break;
        case "file":
          fileInputRef.current?.click();
          break;
        case "audio":
          editor
            .chain()
            .focus()
            .insertContent({
              type: "audioBlock",
              attrs: { blockId: `audio-${Date.now()}` },
            })
            .run();
          break;
        case "pageMention": {
          const coords = editor.view.coordsAtPos(editor.state.selection.from);
          setMentionFilter("");
          setMentionTriggerChar("/");
          setSelectedMentionIndex(0);
          setMentionMenuPosition({ x: coords.left, y: coords.bottom + 6 });
          break;
        }
        case "quote":
          editor.chain().focus().toggleBlockquote().run();
          break;
        case "code":
          editor.chain().focus().toggleCodeBlock().run();
          break;
        case "divider":
          editor.chain().focus().setHorizontalRule().run();
          break;
      }
    },
    [editor, readOnly, slashFilter]
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

  // Re-sync editor content only when unfocused and block content externally differs
  useEffect(() => {
    if (editor && !editor.isFocused && block.content) {
      const currentJson = editor.getJSON();
      if (JSON.stringify(currentJson) !== JSON.stringify(block.content)) {
        editor.commands.setContent(block.content as JSONContent, { emitUpdate: false });
      }
    }
  }, [block.content, editor]);

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
        onDragOver={(e) => {
          if (readOnly) return;
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={() => setIsDragOver(false)}
      >
        {/* Hidden file pickers for slash commands */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.[0]) void handleFileUpload(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.[0]) void handleFileUpload(e.target.files[0]);
            e.target.value = "";
          }}
        />

        {/* Collaboration Sync & Live Presence Bar */}
        {!readOnly && (collabView.status || presenceUsers.length > 0) && (
          <div className={styles.collaborationBar}>
            <div className={styles.collabStatusBadge}>
              <div
                className={`${styles.collabStatusDot} ${
                  collabView.status === "Saving…"
                    ? styles.collabStatusDotSaving
                    : collabView.status === "Offline"
                    ? styles.collabStatusDotOffline
                    : ""
                }`}
              />
              <span>{collabView.status}</span>
            </div>

            {presenceUsers.length > 0 && (
              <div className={styles.presenceAvatars}>
                {presenceUsers.map((user) => (
                  <div
                    key={user.id}
                    className={styles.presenceAvatar}
                    title={user.displayName || "Collaborator"}
                  >
                    {(user.displayName || "U")[0].toUpperCase()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            <div className={styles.pageIconContainer}>
              <div
                className={styles.pageIcon}
                onClick={() => {
                  if (!readOnly) setShowEmojiPicker((prev) => !prev);
                }}
                title={readOnly ? undefined : "Change icon"}
              >
                {block.icon}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  className={styles.removeIconBtn}
                  onClick={() => applyBlockChange({ icon: null })}
                  title="Remove icon"
                >
                  Remove icon
                </button>
              )}
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
        <div className={`${styles.editorArea} ${isDragOver ? styles.editorAreaDropActive : ""}`}>
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
            <div className={styles.slashMenuHeader}>Basic blocks & Media</div>
            {slashCommands.map((cmd, idx) => (
              <button
                key={cmd.title}
                type="button"
                className={`${styles.slashMenuItem} ${idx === selectedSlashIndex ? styles.slashMenuItemActive : ""}`}
                onMouseEnter={() => setSelectedSlashIndex(idx)}
                onClick={() => executeSlashCommand(cmd.id)}
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
