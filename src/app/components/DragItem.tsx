"use client";

/**
 * Click-safe drag & drop primitives built on @dnd-kit/core (MIT).
 *
 * - Drag only starts after the pointer moves 6px (mouse) or after a 250ms press (touch),
 *   so a plain click/tap always reaches the element's onClick.
 * - Right-click never starts a drag (so context menus work).
 * - Interactive descendants (inputs, selects, buttons, links) never start a drag.
 * - A click that immediately follows a completed drag is swallowed.
 */

import React, { useEffect } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type MouseSensorOptions,
  type TouchSensorOptions,
} from "@dnd-kit/core";

const INTERACTIVE = "input,textarea,select,button,a,label,[contenteditable='true'],[data-no-drag]";

function startsOnInteractive(event: { target: EventTarget | null; currentTarget: EventTarget | null }) {
  let node = event.target as HTMLElement | null;
  const root = event.currentTarget as HTMLElement | null;
  while (node && node !== root) {
    if (node.matches?.(INTERACTIVE)) return true;
    node = node.parentElement;
  }
  return false;
}

class SafeMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: (
        { nativeEvent, currentTarget, target }: React.MouseEvent,
        options: MouseSensorOptions
      ) => {
        if (nativeEvent.button !== 0) return false; // left button only
        if (startsOnInteractive({ target, currentTarget })) return false;
        options.onActivation?.({ event: nativeEvent });
        return true;
      },
    },
  ];
}

class SafeTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: (
        { nativeEvent, currentTarget, target }: React.TouchEvent,
        options: TouchSensorOptions
      ) => {
        if (nativeEvent.touches.length > 1) return false;
        if (startsOnInteractive({ target, currentTarget })) return false;
        options.onActivation?.({ event: nativeEvent });
        return true;
      },
    },
  ];
}

let suppressClickUntil = 0;
export function suppressNextClick() {
  suppressClickUntil = Date.now() + 150;
}

/** Prefer concrete items (rows/tabs/days) over generic containers (columns). */
const itemFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args).filter((c) => c.id !== args.active?.id);
  const items = hits.filter((c) => !String(c.id).startsWith("col:"));
  return items.length ? items : hits;
};

export function DragProvider({
  children,
  onStart,
  onEnd,
}: {
  children: React.ReactNode;
  onStart?: (e: DragStartEvent) => void;
  onEnd: (e: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(SafeMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(SafeTouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  useEffect(() => {
    const swallow = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("click", swallow, true);
    return () => window.removeEventListener("click", swallow, true);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={itemFirst}
      onDragStart={onStart}
      onDragEnd={(e) => {
        suppressNextClick();
        onEnd(e);
      }}
      onDragCancel={() => suppressNextClick()}
    >
      {children}
    </DndContext>
  );
}

type DragItemProps = React.HTMLAttributes<HTMLElement> & {
  id: string;
  as?: "div" | "tr" | "button" | "li";
  draggingClassName?: string;
  overClassName?: string;
  disableDrag?: boolean;
};

/** An element that can be dragged and also acts as a drop target for reordering. */
export function DragItem({
  id,
  as = "div",
  draggingClassName,
  overClassName,
  disableDrag,
  className,
  style,
  children,
  ...rest
}: DragItemProps) {
  const drag = useDraggable({ id, disabled: disableDrag });
  const drop = useDroppable({ id });
  const Tag = as as React.ElementType;

  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };

  const t = drag.transform;
  const cls = [className, drag.isDragging ? draggingClassName : "", drop.isOver && !drag.isDragging ? overClassName : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      {...rest}
      ref={setRef}
      className={cls}
      style={{
        ...style,
        ...(t ? { transform: `translate3d(${t.x}px, ${t.y}px, 0)`, position: "relative", zIndex: 50, pointerEvents: "none" } : null),
        ...(drag.isDragging ? { opacity: 0.8, cursor: "grabbing" } : null),
      }}
      {...drag.listeners}
    >
      {children}
    </Tag>
  );
}

/** A drop-only region (e.g. board column, calendar day). */
export function DropZone({
  id,
  className,
  overClassName,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { id: string; overClassName?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div {...rest} ref={setNodeRef} className={[className, isOver ? overClassName : ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
