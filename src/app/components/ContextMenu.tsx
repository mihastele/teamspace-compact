"use client";

/**
 * Shared context-menu system.
 *
 * Any element can declare its own right-click menu by implementing the
 * `ContextMenuSource` contract (or simply passing items to `contextMenuProps`):
 *
 *   <div {...contextMenuProps(() => [{ id: "x", label: "Do X", onSelect: doX }])} />
 *
 * The browser default menu is suppressed only for elements that provide a menu.
 * Nested sources win (innermost handler stops propagation).
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./ContextMenu.module.css";

export type ContextMenuAction = {
  type?: "item";
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};
export type ContextMenuSeparator = { type: "separator"; id?: string };
export type ContextMenuHeader = { type: "header"; id?: string; label: string };
export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator | ContextMenuHeader;

/** Contract for any element/entity that owns a context menu. */
export interface ContextMenuSource {
  getContextMenuItems(): ContextMenuItem[];
}

export type ContextMenuItemsInput = ContextMenuItem[] | (() => ContextMenuItem[]) | ContextMenuSource;

type MenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

let state: MenuState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function resolveItems(input: ContextMenuItemsInput): ContextMenuItem[] {
  if (typeof input === "function") return input();
  if (Array.isArray(input)) return input;
  return input.getContextMenuItems();
}

export function closeContextMenu() {
  if (state) {
    state = null;
    emit();
  }
}

export function openContextMenuAt(x: number, y: number, input: ContextMenuItemsInput) {
  const items = resolveItems(input);
  if (items.length === 0) return;
  state = { x, y, items };
  emit();
}

/** Handler that replaces the native menu with ours. */
export function handleContextMenu(e: React.MouseEvent, input: ContextMenuItemsInput) {
  const items = resolveItems(input);
  if (items.length === 0) return; // no menu -> keep native behaviour
  e.preventDefault();
  e.stopPropagation();
  state = { x: e.clientX, y: e.clientY, items };
  emit();
}

export function contextMenuProps(input: ContextMenuItemsInput) {
  return { onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, input) };
}

/** Open the menu anchored to a button (for "..." triggers). */
export function openContextMenuFromElement(el: HTMLElement, input: ContextMenuItemsInput) {
  const rect = el.getBoundingClientRect();
  openContextMenuAt(rect.right + 4, rect.top, input);
}

export function ContextMenuHost() {
  const menu = useSyncExternalStore(
    subscribe,
    () => state,
    () => null
  );
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    const onCtx = (e: MouseEvent) => {
      // A right-click elsewhere closes the old menu (a new source reopens its own).
      if (ref.current && !ref.current.contains(e.target as Node)) closeContextMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onCtx, true);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={styles.menu}
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if (item.type === "separator") return <div key={item.id ?? `sep-${i}`} className={styles.divider} />;
        if (item.type === "header")
          return (
            <div key={item.id ?? `hdr-${i}`} className={styles.header}>
              {item.label}
            </div>
          );
        return (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            className={`${styles.item} ${item.danger ? styles.danger : ""}`}
            onClick={() => {
              closeContextMenu();
              item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
