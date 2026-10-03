"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { NoteContent } from "@/lib/model";
import { markdownShortcut } from "@/lib/markdown-shortcuts";
import {
  createHistory,
  recordHistory,
  undoHistory,
  redoHistory,
  sameContent,
} from "@/lib/note-history";
import MarkdownText from "./MarkdownText";
import styles from "./BlockEditor.module.css";

type Block = NoteContent["blocks"][number];
type BlockType = Block["type"];
type Command = {
  type: BlockType | "subnote";
  label: string;
  description: string;
  symbol: string;
  level?: Block["level"];
};
type Menu = {
  index: number;
  source: "slash" | "plus";
  query: string;
  active: number;
};
export type BlockEditorProps = {
  value: NoteContent;
  onChange: (content: NoteContent) => void;
  disabled?: boolean;
  onAddSubnote?: () => void;
  renderBoard?: () => ReactNode;
};
const commands: Command[] = [
  {
    type: "paragraph",
    label: "Text",
    description: "A simple paragraph",
    symbol: "T",
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    type: "heading" as const,
    level,
    label: `Heading ${level}`,
    description: `H${level} · ${"#".repeat(level)} followed by space`,
    symbol: `H${level}`,
  })),
  {
    type: "bullet",
    label: "Bullet list",
    description: "- followed by space",
    symbol: "•",
  },
  {
    type: "ordered",
    label: "Numbered list",
    description: "1. followed by space",
    symbol: "1.",
  },
  {
    type: "todo",
    label: "Task list",
    description: "[] followed by space",
    symbol: "☑",
  },
  {
    type: "quote",
    label: "Quote",
    description: "> followed by space",
    symbol: "❞",
  },
  {
    type: "code",
    label: "Code",
    description: "A multiline code block",
    symbol: "<>",
  },
  {
    type: "divider",
    label: "Divider",
    description: "A horizontal rule",
    symbol: "—",
  },
  {
    type: "markdown",
    label: "Markdown",
    description: "CommonMark + tables, task lists, images and footnotes",
    symbol: "M↓",
  },
  {
    type: "board",
    label: "Kanban board",
    description: "Embed the live shared workspace board",
    symbol: "▥",
  },
  {
    type: "subnote",
    label: "Subnote",
    description: "Create a note inside this one",
    symbol: "▤",
  },
];
const emptyBlock = (): Block => ({ type: "paragraph", text: "" });

export default function BlockEditor({
  value,
  onChange,
  disabled = false,
  onAddSubnote,
  renderBoard,
}: BlockEditorProps) {
  const blocks = value.blocks.length ? value.blocks : [emptyBlock()];
  const [storedHistory, setHistory] = useState(() => createHistory(value));
  // A remote reload replaces content rather than letting local undo cross that boundary.
  const history = sameContent(storedHistory.present, value) ? storedHistory : createHistory(value);
  if (history !== storedHistory) setHistory(history);
  const lastBlockRef = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ index: number; offset: number } | null>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const formattedRefs = useRef(new Map<number, HTMLDivElement>());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [feedback, setFeedback] = useState("");
  const menuId = useId();
  const options = commands.filter((command) =>
    `${command.label} ${command.type} ${command.level ? `h${command.level}` : ""}`
      .toLowerCase()
      .includes(menu?.query.toLowerCase() || ""),
  );
  const active = menu
    ? Math.min(menu.active, Math.max(0, options.length - 1))
    : 0;

  useLayoutEffect(() => {
    for (const [index, input] of refs.current.entries()) {
      input.style.height = "auto";
      input.style.height = `${Math.max(input.scrollHeight, (formattedRefs.current.get(index)?.scrollHeight || 0) + 10, 30)}px`;
    }
    const menuElement = commandMenuRef.current;
    const activeItem = menuElement?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (menuElement && activeItem) {
      if (activeItem.offsetTop < menuElement.scrollTop)
        menuElement.scrollTop = activeItem.offsetTop;
      else if (
        activeItem.offsetTop + activeItem.offsetHeight >
        menuElement.scrollTop + menuElement.clientHeight
      )
        menuElement.scrollTop =
          activeItem.offsetTop +
          activeItem.offsetHeight -
          menuElement.clientHeight;
    }
    const target = pendingFocus.current;
    if (target && !disabled) {
      const input = refs.current.get(target.index);
      if (input) {
        input.focus();
        input.setSelectionRange(target.offset, target.offset);
        pendingFocus.current = null;
      }
    }
  }, [value, disabled, menu, focusedIndex]);

  useEffect(() => {
    let previousWidth = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || 0;
      if (width === previousWidth) return;
      previousWidth = width;
      for (const [index, input] of refs.current.entries()) {
        input.style.height = "auto";
        input.style.height = `${Math.max(input.scrollHeight, (formattedRefs.current.get(index)?.scrollHeight || 0) + 10, 30)}px`;
      }
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  function commit(
    next: Block[],
    focus?: { index: number; offset: number },
    group?: string,
  ) {
    if (disabled) return false;
    if (next.length > 1000) {
      setFeedback(
        "A note can hold up to 1,000 blocks. Your current text is preserved.",
      );
      return false;
    }
    if (
      next.some((block) => block.text.length > 20000) ||
      next.reduce((total, block) => total + block.text.length, 0) > 100000
    ) {
      setFeedback(
        "This note is too long. Keep each block under 20,000 characters and the note under 100,000.",
      );
      return false;
    }
    pendingFocus.current = focus || null;
    if (focus)
      container.current
        ?.querySelectorAll("details[open]")
        .forEach((element) => element.removeAttribute("open"));
    setFeedback("");
    const content = { blocks: next.length ? next : [emptyBlock()] };
    setHistory(recordHistory(history, content, group));
    onChange(content);
    return true;
  }
  function travelHistory(direction: "undo" | "redo") {
    if (disabled) return;
    const next =
      direction === "undo" ? undoHistory(history) : redoHistory(history);
    if (next === history) return;
    const index = Math.min(
      lastBlockRef.current,
      Math.max(0, next.present.blocks.length - 1),
    );
    pendingFocus.current = {
      index,
      offset: next.present.blocks[index]?.text.length || 0,
    };
    setMenu(null);
    setFeedback("");
    setHistory(next);
    onChange(next.present);
  }
  function restoreFocus(
    index: number,
    offset = blocks[index]?.text.length || 0,
  ) {
    const input = refs.current.get(index);
    input?.focus();
    input?.setSelectionRange(offset, offset);
  }
  function choose(command: Command) {
    if (!menu || disabled) return;
    const { index, source } = menu;
    const next = blocks.map((block) => ({ ...block }));
    if (command.type === "subnote") {
      if (!onAddSubnote) {
        setFeedback("Save this note before adding a subnote.");
        return;
      }
      if (source === "slash") {
        next[index].text = "";
        if (!commit(next, { index, offset: 0 })) return;
      }
      setMenu(null);
      onAddSubnote?.();
      return;
    }
    let target = index;
    if (source === "slash" || !next[index].text)
      next[index] = {
        type: command.type,
        text: "",
        ...(command.level ? { level: command.level } : {}),
      };
    else {
      target = index + 1;
      next.splice(target, 0, {
        type: command.type,
        text: "",
        ...(command.level ? { level: command.level } : {}),
      });
    }
    if (["board", "divider"].includes(command.type)) {
      next.splice(target + 1, 0, emptyBlock());
      target += 1;
    }
    if (commit(next, { index: target, offset: 0 })) setMenu(null);
  }
  function update(index: number, text: string) {
    const shortcut =
      blocks[index].type === "paragraph" ||
      (blocks[index].type === "bullet" && /^\[[ xX]\] $/.test(text))
        ? markdownShortcut(text)
        : null;
    const next = blocks.map((block, i) =>
      i === index ? shortcut || { ...block, text } : block,
    );
    if (shortcut?.type === "divider") next.splice(index + 1, 0, emptyBlock());
    if (
      !commit(
        next,
        shortcut
          ? {
              index: shortcut.type === "divider" ? index + 1 : index,
              offset: 0,
            }
          : undefined,
        shortcut ? undefined : `typing:${index}`,
      )
    )
      return;
    if (shortcut) {
      setMenu(null);
      return;
    }
    if (/^\/[a-z0-9 -]*$/i.test(text))
      setMenu({ index, source: "slash", query: text.slice(1), active: 0 });
    else if (menu?.index === index) setMenu(null);
  }
  function keyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (disabled || event.nativeEvent.isComposing) return;
    if (menu && menu.index === index) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMenu({
          ...menu,
          active: options.length
            ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length
            : 0,
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && options.length) {
        event.preventDefault();
        choose(options[active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        restoreFocus(index);
        return;
      }
    }
    if (!(event.currentTarget instanceof HTMLTextAreaElement)) return;
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const current = blocks[index];
    if (
      event.key === "Enter" &&
      current.type === "paragraph" &&
      /^(```|---|\*\*\*|___)$/.test(current.text)
    ) {
      event.preventDefault();
      const shortcut = markdownShortcut(`${current.text} `)!;
      const next = blocks.map((block, i) => (i === index ? shortcut : block));
      if (shortcut.type === "divider") next.splice(index + 1, 0, emptyBlock());
      commit(next, {
        index: shortcut.type === "divider" ? index + 1 : index,
        offset: 0,
      });
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !["code", "markdown"].includes(current.type)
    ) {
      event.preventDefault();
      const next = blocks.map((block) => ({ ...block }));
      if (!current.text && ["bullet", "ordered", "todo"].includes(current.type))
        next[index] = { type: "paragraph", text: "" };
      else {
        next[index].text = current.text.slice(0, start);
        next.splice(index + 1, 0, {
          type: ["bullet", "ordered", "todo"].includes(current.type)
            ? current.type
            : "paragraph",
          text: current.text.slice(end),
        });
      }
      const target =
        !current.text && ["bullet", "ordered", "todo"].includes(current.type)
          ? index
          : index + 1;
      if (commit(next, { index: target, offset: 0 })) setMenu(null);
    } else if (event.key === "Backspace" && start === 0 && end === 0) {
      if (current.type !== "paragraph" && !current.text) {
        event.preventDefault();
        commit(
          blocks.map((block, i) =>
            i === index ? { type: "paragraph", text: "" } : block,
          ),
          { index, offset: 0 },
        );
      } else if (
        index > 0 &&
        !["board", "divider"].includes(blocks[index - 1].type)
      ) {
        event.preventDefault();
        const next = blocks.map((block) => ({ ...block }));
        const offset = next[index - 1].text.length;
        next[index - 1].text += current.text;
        next.splice(index, 1);
        if (commit(next, { index: index - 1, offset })) setMenu(null);
      }
    }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>, index: number) {
    if (disabled) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (
      ["code", "markdown"].includes(blocks[index].type) ||
      !/[\r\n]/.test(pasted)
    )
      return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const text =
      blocks[index].text.slice(0, start) +
      pasted.replace(/\r\n?/g, "\n") +
      blocks[index].text.slice(end);
    const next = blocks.map((block, i) =>
      i === index ? { type: "markdown" as const, text } : block,
    );
    if (
      commit(next, {
        index,
        offset: start + pasted.replace(/\r\n?/g, "\n").length,
      })
    )
      setMenu(null);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = blocks.map((block) => ({ ...block }));
    [next[index], next[target]] = [next[target], next[index]];
    if (commit(next, { index: target, offset: next[target].text.length }))
      setMenu(null);
  }
  function remove(index: number) {
    const next = blocks.filter((_, i) => i !== index);
    const target = Math.max(0, index - 1);
    if (commit(next, { index: target, offset: next[target]?.text.length || 0 }))
      setMenu(null);
  }
  function openMenu(index: number) {
    restoreFocus(index);
    setMenu({ index, source: "plus", query: "", active: 0 });
  }

  return (
    <div
      ref={container}
      className={styles.editor}
      aria-label="Inline note blocks"
      onKeyDownCapture={(event) => {
        if (
          disabled ||
          event.nativeEvent.isComposing ||
          event.altKey ||
          (!event.ctrlKey && !event.metaKey)
        )
          return;
        if ((event.target as HTMLElement).closest(`.${styles.embeddedBoard}`))
          return;
        const key = event.key.toLowerCase();
        if (key === "z" || (key === "y" && !event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          travelHistory(key === "y" || event.shiftKey ? "redo" : "undo");
        }
      }}
      onBlur={(event) => {
        if (
          menu &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setMenu(null);
      }}
    >
      <div
        className={styles.historyToolbar}
        role="group"
        aria-label="Note editing history"
      >
        <button
          type="button"
          disabled={disabled || !history.past.length}
          title="Undo (Ctrl/Cmd+Z)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => travelHistory("undo")}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          disabled={disabled || !history.future.length}
          title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => travelHistory("redo")}
        >
          ↷ Redo
        </button>
        <span>Recent changes · this open note</span>
      </div>
      <p className={styles.hint}>
        Type / for blocks, or # + space for a heading. Enter adds a block; Shift
        + Enter adds a line.
      </p>
      {feedback && (
        <p className={styles.feedback} role="alert">
          {feedback}
        </p>
      )}
      {blocks.map((block, index) => (
        <div
          className={`${styles.block} ${styles[block.type]} ${block.type === "heading" ? styles[`heading${block.level ?? 1}`] : ""}`}
          key={index}
        >
          <div className={styles.tools}>
            <button
              type="button"
              className={styles.add}
              disabled={disabled}
              aria-label={`Add block after block ${index + 1}`}
              aria-expanded={menu?.index === index}
              aria-controls={menu?.index === index ? menuId : undefined}
              onClick={() => openMenu(index)}
            >
              +
            </button>
            <details className={styles.controls}>
              <summary
                aria-label={`Block ${index + 1} options`}
                aria-disabled={disabled}
              >
                ⋮
              </summary>
              <div className={styles.controlPanel}>
                <label>
                  Block type
                  <select
                    value={block.type}
                    disabled={disabled}
                    aria-label={`Block ${index + 1} type`}
                    onChange={(event) => {
                      const next = blocks.map((item, i) =>
                        i === index
                          ? {
                              type: event.target.value as BlockType,
                              text: ["board", "divider"].includes(
                                event.target.value,
                              )
                                ? ""
                                : item.text,
                            }
                          : item,
                      );
                      commit(next, { index, offset: block.text.length });
                    }}
                  >
                    <option value="paragraph">Text</option>
                    <option value="heading">Heading</option>
                    <option value="bullet">Bullet list</option>
                    <option value="ordered">Numbered list</option>
                    <option value="todo">Task list</option>
                    <option value="quote">Quote</option>
                    <option value="code">Code</option>
                    <option value="markdown">Markdown</option>
                    {["board", "divider"].includes(block.type) && (
                      <option value={block.type}>{block.type}</option>
                    )}
                  </select>
                </label>
                {block.type === "heading" && (
                  <label>
                    Heading level
                    <select
                      aria-label={`Block ${index + 1} heading level`}
                      value={block.level ?? 1}
                      disabled={disabled}
                      onChange={(event) =>
                        commit(
                          blocks.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  level: Number(
                                    event.target.value,
                                  ) as Block["level"],
                                }
                              : item,
                          ),
                          { index, offset: block.text.length },
                        )
                      }
                    >
                      {[1, 2, 3, 4, 5, 6].map((level) => (
                        <option key={level} value={level}>
                          Heading {level}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  disabled={disabled || index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓ Move down
                </button>
                <button
                  type="button"
                  className={styles.delete}
                  disabled={disabled}
                  onClick={() => remove(index)}
                >
                  Delete block
                </button>
              </div>
            </details>
          </div>
          {block.type === "bullet" && (
            <span className={styles.bulletMark} aria-hidden="true">
              •
            </span>
          )}
          {block.type === "ordered" && (
            <span className={styles.bulletMark} aria-hidden="true">
              {blocks
                .slice(0, index)
                .reverse()
                .findIndex((item) => item.type !== "ordered") < 0
                ? index + 1
                : blocks
                    .slice(0, index)
                    .reverse()
                    .findIndex((item) => item.type !== "ordered") + 1}
              .
            </span>
          )}
          {block.type === "todo" && (
            <input
              type="checkbox"
              className={styles.checkbox}
              aria-label={`Complete task-list block ${index + 1}`}
              checked={block.checked ?? false}
              disabled={disabled}
              onChange={(event) =>
                commit(
                  blocks.map((item, i) =>
                    i === index
                      ? { ...item, checked: event.target.checked }
                      : item,
                  ),
                )
              }
            />
          )}
          {block.type === "board" ? (
            <div className={styles.embeddedBoard}>
              {renderBoard?.()}
              <small>
                Changes here update the shared workspace board. Removing this
                block keeps its tasks.
              </small>
            </div>
          ) : block.type === "divider" ? (
            <hr className={styles.divider} />
          ) : (
            <textarea
              ref={(element) => {
                if (element) refs.current.set(index, element);
                else refs.current.delete(index);
              }}
              rows={1}
              maxLength={20000}
              className={`${styles.text} ${focusedIndex !== index && !["code", "markdown"].includes(block.type) && /[\*_~`\[\]]/.test(block.text) ? styles.formattedSource : ""}`}
              value={block.text}
              disabled={disabled}
              aria-label={`${block.type === "paragraph" ? "Text" : block.type === "heading" ? `Heading ${block.level ?? 1}` : block.type === "bullet" ? "Bullet list item" : block.type} block ${index + 1}`}
              placeholder={
                block.type === "heading"
                  ? "Heading"
                  : block.type === "bullet"
                    ? "List item"
                    : index === 0
                      ? "Write something, or type / for blocks…"
                      : "Type / for blocks…"
              }
              aria-controls={menu?.index === index ? menuId : undefined}
              aria-expanded={menu?.index === index ? true : undefined}
              aria-activedescendant={
                menu?.index === index && options.length
                  ? `${menuId}-${active}`
                  : undefined
              }
              onFocus={() => {
                lastBlockRef.current = index;
                setFocusedIndex(index);
                if (menu && menu.index !== index) setMenu(null);
              }}
              onBlur={() => setFocusedIndex(null)}
              onChange={(event) => update(index, event.target.value)}
              onKeyDown={(event) => keyDown(event, index)}
              onPaste={(event) => paste(event, index)}
            />
          )}
          {focusedIndex !== index &&
            !["code", "markdown"].includes(block.type) &&
            /[\*_~`\[\]]/.test(block.text) && (
              <div
                className={styles.formatted}
                ref={(element) => {
                  if (element) formattedRefs.current.set(index, element);
                  else formattedRefs.current.delete(index);
                }}
                aria-label="Formatted block text"
              >
                <MarkdownText text={block.text} />
              </div>
            )}
          {block.type === "markdown" && (
            <div
              className={styles.markdownPreview}
              aria-label="Live Markdown preview"
            >
              <MarkdownText text={block.text} />
            </div>
          )}
          {menu?.index === index && !disabled && (
            <div
              className={styles.menu}
              ref={commandMenuRef}
              id={menuId}
              role="listbox"
              aria-label="Insert a block"
              onKeyDown={(event) => keyDown(event, index)}
            >
              <p className={styles.menuLabel}>ADD A BLOCK</p>
              {options.length ? (
                options.map((command, optionIndex) => (
                  <button
                    type="button"
                    key={`${command.type}-${command.level ?? 0}`}
                    id={`${menuId}-${optionIndex}`}
                    role="option"
                    aria-disabled={command.type === "subnote" && !onAddSubnote}
                    disabled={command.type === "subnote" && !onAddSubnote}
                    aria-selected={optionIndex === active}
                    className={
                      optionIndex === active ? styles.activeOption : ""
                    }
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(command)}
                  >
                    <span className={styles.commandIcon}>{command.symbol}</span>
                    <span>
                      <strong>{command.label}</strong>
                      <small>
                        {command.type === "subnote" && !onAddSubnote
                          ? "Save this note first to add a subnote"
                          : command.description}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.noResults}>
                  No matching blocks. Press Escape to keep typing.
                </p>
              )}
              <p className={styles.menuHint}>
                ↑ ↓ to choose · Enter to insert · Esc to close
              </p>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className={styles.bottomAdd}
        disabled={disabled}
        aria-label="Add a block"
        onClick={() => openMenu(blocks.length - 1)}
      >
        + Add a block
      </button>
    </div>
  );
}
