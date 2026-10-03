"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import type { NoteContent } from "@/lib/model";
import styles from "./BlockEditor.module.css";

type Block = NoteContent["blocks"][number];
type BlockType = Block["type"];
type Command = {
  type: BlockType | "subnote";
  label: string;
  description: string;
  symbol: string;
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
};
const commands: Command[] = [
  {
    type: "paragraph",
    label: "Text",
    description: "Start with a simple paragraph",
    symbol: "T",
  },
  {
    type: "heading",
    label: "Heading",
    description: "Give your ideas a little structure",
    symbol: "H",
  },
  {
    type: "bullet",
    label: "Bullet list",
    description: "Make a list, one idea at a time",
    symbol: "•",
  },
  {
    type: "subnote",
    label: "Subnote",
    description: "Create a note inside this one",
    symbol: "▤",
  },
];
const emptyBlock = (): Block => ({ type: "paragraph", text: "" });

function FormattedText({ text }: { text: string }) {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        try {
          const url = new URL(match[2]);
          if (["http:", "https:"].includes(url.protocol))
            return (
              <a
                key={index}
                href={url.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {match[1]}
              </a>
            );
        } catch {
          /* Unsupported URLs stay visible as text. */
        }
      }
      return <span key={index}>{part}</span>;
    });
}
export default function BlockEditor({
  value,
  onChange,
  disabled = false,
  onAddSubnote,
}: BlockEditorProps) {
  const blocks = value.blocks.length ? value.blocks : [emptyBlock()];
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ index: number; offset: number } | null>(null);
  const formattedRefs = useRef(new Map<number, HTMLDivElement>());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [feedback, setFeedback] = useState("");
  const menuId = useId();
  const options = commands.filter((command) =>
    `${command.label} ${command.type}`
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

  function commit(next: Block[], focus?: { index: number; offset: number }) {
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
    onChange({ blocks: next.length ? next : [emptyBlock()] });
    return true;
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
      next[index] = { type: command.type, text: "" };
    else {
      target = index + 1;
      next.splice(target, 0, { type: command.type, text: "" });
    }
    if (commit(next, { index: target, offset: 0 })) setMenu(null);
  }
  function update(index: number, text: string) {
    const next = blocks.map((block, i) =>
      i === index ? { ...block, text } : block,
    );
    if (!commit(next)) return;
    if (/^\/[a-z ]*$/i.test(text))
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const next = blocks.map((block) => ({ ...block }));
      if (!current.text && current.type === "bullet")
        next[index].type = "paragraph";
      else {
        next[index].text = current.text.slice(0, start);
        next.splice(index + 1, 0, {
          type: current.type === "bullet" ? "bullet" : "paragraph",
          text: current.text.slice(end),
        });
      }
      const target =
        !current.text && current.type === "bullet" ? index : index + 1;
      if (commit(next, { index: target, offset: 0 })) setMenu(null);
    } else if (event.key === "Backspace" && start === 0 && end === 0) {
      if (current.type !== "paragraph" && !current.text) {
        event.preventDefault();
        commit(
          blocks.map((block, i) =>
            i === index ? { ...block, type: "paragraph" } : block,
          ),
          { index, offset: 0 },
        );
      } else if (index > 0) {
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
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const lines = pasted.replace(/\r\n?/g, "\n").split("\n");
    const prefix = blocks[index].text.slice(0, start);
    const suffix = blocks[index].text.slice(end);
    const inserted = lines.map((line, i): Block => {
      const type =
        i === 0
          ? blocks[index].type
          : line.startsWith("# ")
            ? "heading"
            : line.startsWith("- ")
              ? "bullet"
              : blocks[index].type === "bullet"
                ? "bullet"
                : "paragraph";
      const text = i > 0 ? line.replace(/^(# |- )/, "") : line;
      return {
        type,
        text: `${i === 0 ? prefix : ""}${text}${i === lines.length - 1 ? suffix : ""}`,
      };
    });
    const next = [
      ...blocks.slice(0, index),
      ...inserted,
      ...blocks.slice(index + 1),
    ];
    const target = index + inserted.length - 1;
    if (
      commit(next, {
        index: target,
        offset: inserted[inserted.length - 1].text.length - suffix.length,
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
      onBlur={(event) => {
        if (
          menu &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setMenu(null);
      }}
    >
      <p className={styles.hint}>
        Type / for blocks. Enter adds a block. Shift + Enter adds a line.
      </p>
      {feedback && (
        <p className={styles.feedback} role="alert">
          {feedback}
        </p>
      )}
      {blocks.map((block, index) => (
        <div className={`${styles.block} ${styles[block.type]}`} key={index}>
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
                          ? { ...item, type: event.target.value as BlockType }
                          : item,
                      );
                      commit(next, { index, offset: block.text.length });
                    }}
                  >
                    <option value="paragraph">Text</option>
                    <option value="heading">Heading</option>
                    <option value="bullet">Bullet list</option>
                  </select>
                </label>
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
          <textarea
            ref={(element) => {
              if (element) refs.current.set(index, element);
              else refs.current.delete(index);
            }}
            rows={1}
            maxLength={20000}
            className={`${styles.text} ${focusedIndex !== index && /\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\)/.test(block.text) ? styles.formattedSource : ""}`}
            value={block.text}
            disabled={disabled}
            aria-label={`${block.type === "paragraph" ? "Text" : block.type === "heading" ? "Heading" : "Bullet list item"} block ${index + 1}`}
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
              setFocusedIndex(index);
              if (menu && menu.index !== index) setMenu(null);
            }}
            onBlur={() => setFocusedIndex(null)}
            onChange={(event) => update(index, event.target.value)}
            onKeyDown={(event) => keyDown(event, index)}
            onPaste={(event) => paste(event, index)}
          />
          {focusedIndex !== index &&
            /\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\)/.test(block.text) && (
              <div
                className={styles.formatted}
                ref={(element) => {
                  if (element) formattedRefs.current.set(index, element);
                  else formattedRefs.current.delete(index);
                }}
                aria-label="Formatted block text"
              >
                <FormattedText text={block.text} />
              </div>
            )}
          {menu?.index === index && !disabled && (
            <div
              className={styles.menu}
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
                    key={command.type}
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
