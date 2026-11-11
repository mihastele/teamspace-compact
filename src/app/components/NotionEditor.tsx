"use client";

import React, { useEffect, useState, useRef } from "react";
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

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
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      updateBlock(block.id, { content: json });

      // Check if user typed slash at cursor
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
      const match = textBefore.match(/\/([a-zA-Z0-9]*)$/);

      if (match) {
        setSlashFilter(match[1]);
        const view = editor.view;
        const coords = view.coordsAtPos(from);
        setSlashMenuPosition({ x: coords.left, y: coords.bottom + 6 });
      } else {
        setSlashMenuPosition(null);
      }
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === "Escape") {
          setSlashMenuPosition(null);
          return false;
        }
        return false;
      },
    },
  });

  // Re-sync editor content when switching pages
  useEffect(() => {
    if (editor && block.content) {
      const currentJson = editor.getJSON();
      if (JSON.stringify(currentJson) !== JSON.stringify(block.content)) {
        editor.commands.setContent(block.content as JSONContent);
      }
    }
  }, [block.id, block.content, editor]);

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

  const executeSlashCommand = (action: () => void) => {
    if (!editor) return;
    // Remove the slash and filter text
    const { from } = editor.state.selection;
    const deleteCount = slashFilter.length + 1;
    editor.commands.deleteRange({ from: from - deleteCount, to: from });
    action();
    setSlashMenuPosition(null);
    editor.commands.focus();
  };

  const slashCommands = [
    {
      title: "Heading 1",
      icon: <Heading1 size={15} />,
      action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: "Heading 2",
      icon: <Heading2 size={15} />,
      action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: "Heading 3",
      icon: <Heading3 size={15} />,
      action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: "To-do List",
      icon: <CheckSquare size={15} />,
      action: () => editor?.chain().focus().toggleTaskList().run(),
    },
    {
      title: "Bullet List",
      icon: <List size={15} />,
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered List",
      icon: <ListOrdered size={15} />,
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      title: "Quote",
      icon: <Quote size={15} />,
      action: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "Code Block",
      icon: <Code size={15} />,
      action: () => editor?.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      icon: <Minus size={15} />,
      action: () => editor?.chain().focus().setHorizontalRule().run(),
    },
  ].filter((c) => c.title.toLowerCase().includes(slashFilter.toLowerCase()));

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
          <div className={styles.emojiPicker}>
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
          className={styles.slashMenu}
          style={{
            top: `${slashMenuPosition.y}px`,
            left: `${slashMenuPosition.x}px`,
          }}
        >
          <div className={styles.slashMenuHeader}>Basic blocks</div>
          {slashCommands.map((cmd) => (
            <button
              key={cmd.title}
              className={styles.slashMenuItem}
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
