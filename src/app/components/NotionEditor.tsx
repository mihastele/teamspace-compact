"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useWorkspace } from "@/lib/workspace-store";
import type { Block } from "@/lib/model";
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
} from "lucide-react";
import styles from "./NotionEditor.module.css";

const emojiOptions = ["📄", "📝", "💡", "🎯", "🚀", "🔥", "📚", "🎨", "⚡", "🌟", "📌", "🛠️", "💬", "✅"];

export default function NotionEditor({ block }: { block: Block }) {
  const { updateBlock } = useWorkspace();
  const [title, setTitle] = useState(block.title);
  const [prevBlockTitle, setPrevBlockTitle] = useState(block.title);
  const [prevBlockId, setPrevBlockId] = useState(block.id);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Sync title during render when block changes externally without triggering an effect setState
  if (block.id !== prevBlockId || block.title !== prevBlockTitle) {
    setPrevBlockId(block.id);
    setPrevBlockTitle(block.title);
    setTitle(block.title);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: "Type '/' for commands or start writing...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: (block.content as JSONContent) || {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      updateBlock(block.id, { content: json });

      // Check if user typed slash at cursor
      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(Math.max(0, from - 20), from);
      const match = textBefore.match(/\/([a-zA-Z0-9]*)$/);

      if (match) {
        setSlashFilter(match[1]);
        setSelectedSlashIndex(0);
        const view = ed.view;
        const coords = view.coordsAtPos(from);
        setSlashMenuPosition({ x: coords.left, y: coords.bottom + 6 });
      } else {
        setSlashMenuPosition(null);
      }
    },
    editorProps: {
      handleKeyDown: (view, event) => {
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

  const slashCommands = useMemo(() => [
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
  ].filter((c) => c.title.toLowerCase().includes(slashFilter.toLowerCase())), [slashFilter]);

  const executeSlashCommand = useCallback((action: (ed: ReturnType<typeof useEditor>) => void) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const deleteCount = slashFilter.length + 1;
    editor.commands.deleteRange({ from: from - deleteCount, to: from });
    action(editor);
    setSlashMenuPosition(null);
    editor.commands.focus();
  }, [editor, slashFilter]);

  // Keep ref for current slash menu state so Tiptap handleKeyDown always has current state
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

  // Re-sync editor content only when unfocused and content externally differs
  useEffect(() => {
    if (editor && !editor.isFocused && block.content) {
      const currentJson = editor.getJSON();
      if (JSON.stringify(currentJson) !== JSON.stringify(block.content)) {
        editor.commands.setContent(block.content as JSONContent, { emitUpdate: false });
      }
    }
  }, [block.id, block.content, editor]);

  // Click-outside listener to dismiss emoji picker and slash menu
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        slashMenuPosition &&
        slashMenuRef.current &&
        !slashMenuRef.current.contains(e.target as Node)
      ) {
        setSlashMenuPosition(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowEmojiPicker(false);
        setSlashMenuPosition(null);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showEmojiPicker, slashMenuPosition]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setTitle(nextTitle);
    updateBlock(block.id, { title: nextTitle });
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.commands.focus("start");
    }
  };

  return (
    <div className={styles.canvasContainer}>
      {/* Page Header */}
      <div className={styles.header}>
        {/* Hover trigger to add icon or cover if none exists */}
        <div className={styles.pageMetadataActions}>
          <button
            className={styles.metaBtn}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            <Smile size={14} />
            <span>{block.icon ? "Change icon" : "Add icon"}</span>
          </button>
        </div>

        {/* Page Icon Display */}
        {block.icon && (
          <div
            className={styles.pageIcon}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Change icon"
          >
            {block.icon}
          </div>
        )}

        {showEmojiPicker && (
          <div ref={emojiPickerRef} className={styles.emojiPicker}>
            {emojiOptions.map((emoji) => (
              <button
                key={emoji}
                className={styles.emojiOption}
                onClick={() => {
                  updateBlock(block.id, { icon: emoji });
                  setShowEmojiPicker(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Title Input */}
        <input
          ref={titleInputRef}
          className={styles.titleInput}
          placeholder="Untitled"
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
        />
      </div>

      {/* Tiptap Block Editor Content */}
      <div className={styles.editorArea}>
        <EditorContent editor={editor} />
      </div>

      {/* Floating Slash Command Menu */}
      {slashMenuPosition && slashCommands.length > 0 && (
        <div
          ref={slashMenuRef}
          className={styles.slashMenu}
          style={{
            top: `${slashMenuPosition.y}px`,
            left: `${slashMenuPosition.x}px`,
          }}
        >
          <div className={styles.slashMenuHeader}>Basic blocks</div>
          {slashCommands.map((cmd, idx) => (
            <button
              key={cmd.title}
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
    </div>
  );
}
