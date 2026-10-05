"use client";

import { useSyncExternalStore } from "react";
import { localCalendarDay } from "./task-deadlines";

const subscribers = new Set<() => void>();
let timer: number | undefined;
function notifyAll() {
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void) {
  if (subscribers.size === 0) {
    timer = window.setInterval(notifyAll, 30_000);
    window.addEventListener("focus", notifyAll);
    document.addEventListener("visibilitychange", notifyAll);
  }
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", notifyAll);
      document.removeEventListener("visibilitychange", notifyAll);
    }
  };
}

// The server cannot know the viewer's timezone. Reconcile after hydration.
export function useLocalDay() {
  return useSyncExternalStore(
    subscribe,
    () => localCalendarDay(new Date()),
    () => "",
  );
}
