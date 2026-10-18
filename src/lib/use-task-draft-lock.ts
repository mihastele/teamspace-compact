"use client";
import { useEffect, useState } from "react";

/** One editor may persist/retry a task draft per account/workspace on this device. */
export function useTaskDraftLock(key: string, onAcquire: () => void | Promise<void>) {
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void Promise.resolve().then(async () => {
      // Strict Mode's discarded setup must not briefly take the live setup's lock.
      if (!active || !navigator.locks) return;
      await navigator.locks.request(key, { signal: controller.signal }, async lock => {
        if (!lock || !active) return;
        const held = new Promise<void>(resolve => { release = resolve; });
        await onAcquire();
        if (!active) return;
        setOwned(true);
        await held;
      });
    }).catch(() => { /* The editor stays read-only if locking is unavailable. */ });
    return () => { active = false; controller.abort(); release?.(); };
  }, [key, onAcquire]);
  return owned;
}
