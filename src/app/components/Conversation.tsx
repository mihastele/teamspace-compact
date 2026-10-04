"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { ConversationComment } from "@/lib/model";
import {
  commentIdentity,
  commentWindow,
  validCommentDraft,
  canReleaseCommentRejection,
  type CommentDraft,
} from "@/lib/conversations";
import s from "./Conversation.module.css";
import ConversationBody from "./ConversationBody";
export { default as ConversationBody } from "./ConversationBody";

type Api = ReturnType<typeof useTeamspace>;
type LocalDraft = CommentDraft;

function failure(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Your message has been kept.";
}
/** Parent keys this component by account/workspace/entity; drafts never cross scopes. */
export default function Conversation({
  api,
  parentType,
  parentId,
  disabled = false,
  onRecoveryRisk,
}: {
  api: Api;
  parentType: "note" | "task";
  parentId: string;
  disabled?: boolean;
  onRecoveryRisk?: (risk: boolean) => void;
}) {
  const identity = api.user?.uid || "preview";
  const storageKey = `teamspace-comment-draft-v1:${identity}:${api.workspace!.id}:${parentType}:${parentId}`;
  const inputId = useId();
  const memberId = useId();
  const text = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(false);
  const lifetime = useRef(0);
  const ownsDraft = useRef(false);
  const busyGuard = useRef(false);
  const restoredLocal = useRef(false);
  const tombstones = useRef(new Map<string, ConversationComment>());
  const observed = useRef(new Set<string>());
  const latestRows = useRef<ConversationComment[]>([]);
  const readableState = useRef(true);
  const draftRef = useRef<LocalDraft>({ version: 1, body: "", pending: null });
  const [draft, setDraft] = useState<LocalDraft>({
    version: 1,
    body: "",
    pending: null,
  });
  const [locked, setLocked] = useState(true);
  const [lockEpoch, setLockEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<ConversationComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [listenerError, setListenerError] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [blockedRecovery, setBlockedRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ConversationComment | null>(
    null,
  );
  const [acknowledgedRows, setAcknowledgedRows] = useState<
    ConversationComment[]
  >([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    lifetime.current += 1;
    let releaseLock: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    // Read browser storage after hydration; retain any in-memory draft on read failures.
    const restoreDraft = () => {
      if (cancelled) return;
      if (restoredLocal.current) return;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const restored: unknown = JSON.parse(raw);
          if (!validCommentDraft(restored))
            throw new Error("Stored comment recovery is invalid.");
          draftRef.current = restored;
          setDraft(restored);
        }
        setStorageError("");
        setBlockedRecovery(false);
        restoredLocal.current = true;
      } catch {
        setStorageError(
          "Local comment recovery could not be read. Browser data is unchanged. Retry recovery, or copy your draft before leaving.",
        );
        setBlockedRecovery(true);
      }
      setLoaded(true);
    };
    const acquire = async () => {
      try {
        if (!navigator.locks)
          throw new Error(
            "Safe comment drafts require a browser with Web Locks. You can still read the conversation.",
          );
        await navigator.locks.request(
          `teamspace-comment-draft:${storageKey}`,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (!lock) {
              setLocked(true);
              setLoaded(true);
              return;
            }
            ownsDraft.current = true;
            setLocked(false);
            restoreDraft();
            await released;
          },
        );
      } catch (error) {
        if (!cancelled) {
          setStorageError(failure(error));
          setLocked(true);
          setLoaded(true);
        }
      }
    };
    void acquire();
    return () => {
      cancelled = true;
      alive.current = false;
      lifetime.current += 1;
      ownsDraft.current = false;
      releaseLock?.();
    };
    // The parent keys by account/workspace/entity; only an explicit lock retry restarts ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockEpoch]);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = api.subscribeComments(
      parentType,
      parentId,
      (next) => {
        if (cancelled) return;
        readableState.current = true;
        for (const comment of next) {
          observed.current.add(comment.id);
          if (comment.deleted) tombstones.current.set(comment.id, comment);
        }
        setRows(
          next.map((comment) => tombstones.current.get(comment.id) || comment),
        );
        latestRows.current = next.map(
          (comment) => tombstones.current.get(comment.id) || comment,
        );
        setAcknowledgedRows((previous) =>
          previous.filter(
            (comment) =>
              !next.some((row) => row.id === comment.id) &&
              (next.length < 50 ||
                commentWindow([...next, comment]).some(
                  (row) => row.id === comment.id,
                )),
          ),
        );
        setOptimistic((previous) =>
          previous && next.some((row) => row.id === previous.id)
            ? null
            : previous,
        );
        setLoading(false);
        setListenerError("");
      },
      (error) => {
        if (cancelled) return;
        readableState.current = false;
        latestRows.current = [];
        setRows([]);
        setAcknowledgedRows([]);
        setOptimistic(null);
        setLoading(false);
        setListenerError(failure(error));
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // The parent scope key remounts this component on any entity/account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (draft.body.trim() || draft.pending) event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);
  useEffect(() => {
    onRecoveryRisk?.(
      Boolean(
        storageError && (blockedRecovery || draft.body.trim() || draft.pending),
      ),
    );
    return () => onRecoveryRisk?.(false);
  }, [storageError, blockedRecovery, draft, onRecoveryRisk]);

  function persist(next: LocalDraft) {
    if (!ownsDraft.current) return false;
    try {
      if (!next.body && !next.pending) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "This draft could not be saved on this device. Copy or download it before leaving. Posting waits until recovery storage works.",
      );
      return false;
    }
  }
  function change(body: string) {
    if (
      draftRef.current.pending ||
      busyGuard.current ||
      disabled ||
      blockedRecovery ||
      !ownsDraft.current
    )
      return;
    const next: LocalDraft = { version: 1, body, pending: null };
    draftRef.current = next;
    setDraft(next);
    persist(next);
  }
  function mention(uid: string) {
    if (!uid) return;
    const input = text.current;
    const body = draftRef.current.body;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? start;
    const token = `@{${uid}} `;
    if (body.length - (end - start) + token.length > 4000) {
      setError(
        "There is not enough room for this mention. Shorten the message first.",
      );
      return;
    }
    change(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  async function post() {
    if (
      busyGuard.current ||
      !loaded ||
      disabled ||
      blockedRecovery ||
      !ownsDraft.current ||
      !readableState.current
    )
      return;
    const capturedLifetime = lifetime.current;
    const current = draftRef.current;
    if (!current.pending && !current.body.trim()) return;
    const request = current.pending || {
      operationId: crypto.randomUUID(),
      body: current.body,
    };
    const frozen: LocalDraft = {
      version: 1,
      body: current.body,
      pending: request,
    };
    // The exact operation/body survives refresh before any network mutation starts.
    if (!persist(frozen)) return;
    draftRef.current = frozen;
    setDraft(frozen);
    busyGuard.current = true;
    setBusy(true);
    setError("");
    setAcknowledged(false);
    try {
      const optimisticId = await commentIdentity(
        identity,
        request.operationId,
        api.configured,
      );
      if (
        !alive.current ||
        lifetime.current !== capturedLifetime ||
        !ownsDraft.current
      )
        return;
      if (readableState.current && !observed.current.has(optimisticId))
        setOptimistic({
          id: optimisticId,
          body: request.body,
          authorId: identity,
          authorName: api.user?.displayName || "You",
          createdAt: Date.now(),
          deleted: false,
          mentions: api.members
            .filter((member) => request.body.includes(`@{${member.id}}`))
            .map((member) => ({
              uid: member.id,
              displayName: member.displayName,
            })),
        });
      const saved = await api.postComment(parentType, parentId, request);
      if (
        !alive.current ||
        lifetime.current !== capturedLifetime ||
        !ownsDraft.current
      )
        return;
      if (saved.deleted) tombstones.current.set(saved.id, saved);
      const acknowledgedComment = tombstones.current.get(saved.id) || saved;
      setOptimistic(null);
      if (
        readableState.current &&
        !observed.current.has(saved.id) &&
        (latestRows.current.length < 50 ||
          commentWindow([...latestRows.current, acknowledgedComment]).some(
            (comment) => comment.id === saved.id,
          ))
      )
        setAcknowledgedRows((previous) =>
          [
            ...previous.filter((comment) => comment.id !== saved.id),
            acknowledgedComment,
          ].slice(-50),
        );
      setAcknowledged(true);
      setAnnouncement("Comment sent.");
      const cleared: LocalDraft = { version: 1, body: "", pending: null };
      if (persist(cleared)) {
        draftRef.current = cleared;
        setDraft(cleared);
        text.current?.focus();
      } else
        setError(
          "Your comment was sent, but its local recovery copy could not be cleared. Retry the same request to clear it safely.",
        );
    } catch (error) {
      if (
        !alive.current ||
        lifetime.current !== capturedLifetime ||
        !ownsDraft.current
      )
        return;
      setError(failure(error));
      // A rejection of a retry cannot prove an earlier uncertain attempt failed.
      // Keep its identity even if access was revoked after the original commit.
      if (canReleaseCommentRejection(Boolean(current.pending), error)) {
        const rejected: LocalDraft = {
          version: 1,
          body: current.body,
          pending: null,
        };
        if (persist(rejected)) {
          draftRef.current = rejected;
          setDraft(rejected);
          setOptimistic(null);
        }
      }
    } finally {
      busyGuard.current = false;
      if (alive.current && lifetime.current === capturedLifetime)
        setBusy(false);
    }
  }
  async function remove(comment: ConversationComment) {
    if (
      busyGuard.current ||
      disabled ||
      comment.authorId !== identity ||
      !confirm(
        "Delete this comment? Its text and mentions will be removed for everyone.",
      )
    )
      return;
    busyGuard.current = true;
    const capturedLifetime = lifetime.current;
    setDeleting(comment.id);
    setError("");
    try {
      await api.deleteComment(parentType, parentId, comment.id);
      if (alive.current && lifetime.current === capturedLifetime) {
        const deleted = { ...comment, body: "", mentions: [], deleted: true };
        tombstones.current.set(comment.id, deleted);
        setRows((previous) =>
          previous.map((row) => (row.id === comment.id ? deleted : row)),
        );
        setAcknowledgedRows((previous) =>
          previous.map((row) => (row.id === comment.id ? deleted : row)),
        );
        setOptimistic((previous) =>
          previous?.id === comment.id ? deleted : previous,
        );
        setAnnouncement("Comment deleted.");
      }
    } catch (error) {
      if (alive.current && lifetime.current === capturedLifetime)
        setError(failure(error));
    } finally {
      busyGuard.current = false;
      if (alive.current && lifetime.current === capturedLifetime)
        setDeleting(null);
    }
  }
  function download(draftOnly = false) {
    const comments = displayed.filter((comment) => !comment.deleted);
    const readable = (comment: ConversationComment) =>
      comment.body.replace(/@\{([^{}]+)\}/g, (token, uid: string) => {
        const person = comment.mentions.find((mention) => mention.uid === uid);
        return person ? `@${person.displayName}` : token;
      });
    const content = draftOnly
      ? draftRef.current.body
      : comments
          .map(
            (comment) =>
              `${comment.authorName} · ${new Date(comment.createdAt).toISOString()}\n\n${readable(comment)}`,
          )
          .join("\n\n---\n\n");
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob(
          [
            `# ${draftOnly ? "Local comment draft" : "Conversation · latest 50 comments"}\n\n${content}\n`,
          ],
          { type: "text/markdown;charset=utf-8" },
        ),
      );
      link.href = url;
      link.download = `${parentType}-${parentId}-${draftOnly ? "comment-draft" : "conversation"}.md`;
      document.body.appendChild(link);
      link.click();
    } catch {
      setError(
        "Download could not start. Copy the message text manually or try again.",
      );
    } finally {
      link.remove();
      if (url) {
        const captured = url;
        setTimeout(() => URL.revokeObjectURL(captured), 1000);
      }
    }
  }
  const displayed = commentWindow([
    ...rows,
    ...acknowledgedRows.filter(
      (comment) => !rows.some((row) => row.id === comment.id),
    ),
  ]);
  const optimisticVisible =
    optimistic && !displayed.some((comment) => comment.id === optimistic.id);
  return (
    <section className={s.conversation} aria-label="Conversation">
      <header className={s.header}>
        <div>
          <h3>Conversation</h3>
          <p>
            {api.configured
              ? "Discuss this work with your workspace."
              : "This device · preview conversation"}
          </p>
        </div>
        <button
          type="button"
          disabled={!displayed.some((comment) => !comment.deleted)}
          onClick={() => download()}
        >
          Download conversation
        </button>
      </header>
      <p className={s.hint}>
        Latest 50 comments. Mentions highlight people here; notifications are
        not sent.
      </p>
      {locked && loaded && (
        <div className={s.notice} role="status">
          Drafting is active in another tab, or safe recovery locking is
          unavailable. This conversation stays readable.
          <button
            type="button"
            disabled={busy || Boolean(deleting)}
            onClick={() => setLockEpoch((value) => value + 1)}
          >
            Enable drafting here
          </button>
        </div>
      )}
      {listenerError && (
        <div className={s.error} role="alert">
          {listenerError}
          <button
            type="button"
            onClick={() => {
              api.restartSubscriptions();
              setEpoch((value) => value + 1);
            }}
          >
            Reconnect conversation
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className={s.empty}>
          Loading conversation…
        </p>
      ) : !displayed.length && !optimisticVisible ? (
        <p className={s.empty}>
          A question, a decision, a little context. Start the conversation.
        </p>
      ) : null}
      <ol className={s.messages}>
        {displayed.map((comment) => (
          <li key={comment.id}>
            <div className={s.byline}>
              <strong>{comment.authorName}</strong>
              <time dateTime={new Date(comment.createdAt).toISOString()}>
                {new Date(comment.createdAt).toLocaleString()}
              </time>
              {!comment.deleted && comment.authorId === identity && (
                <button
                  type="button"
                  disabled={Boolean(deleting) || busy || disabled}
                  onClick={() => void remove(comment)}
                  aria-label={`Delete comment by ${comment.authorName}`}
                >
                  {deleting === comment.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            {comment.deleted ? (
              <p className={s.deleted}>Comment deleted.</p>
            ) : (
              <ConversationBody
                comment={comment}
                className={s.body}
                mentionClassName={s.mention}
              />
            )}
          </li>
        ))}
        {optimisticVisible && (
          <li className={s.pending}>
            <div className={s.byline}>
              <strong>You</strong>
              <span>
                {acknowledged
                  ? "Sent"
                  : busy
                    ? "Sending…"
                    : "Awaiting confirmation"}
              </span>
            </div>
            <ConversationBody
              comment={optimistic!}
              className={s.body}
              mentionClassName={s.mention}
            />
          </li>
        )}
      </ol>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {storageError && (
        <div className={s.error} role="alert">
          {storageError}
          {blockedRecovery && (
            <button
              type="button"
              onClick={() => setLockEpoch((value) => value + 1)}
            >
              Retry local recovery
            </button>
          )}
        </div>
      )}
      <div className={s.composer}>
        <label htmlFor={inputId}>Add a comment</label>
        <textarea
          id={inputId}
          ref={text}
          value={draft.body}
          maxLength={4000}
          disabled={
            !loaded ||
            disabled ||
            busy ||
            Boolean(draft.pending) ||
            blockedRecovery ||
            locked
          }
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (!event.nativeEvent.isComposing) void post();
            }
          }}
          placeholder="Share a thought. Add a mention with the picker below."
        />
        {draft.body.includes("@{") && (
          <div className={s.composerPreview} aria-label="Comment preview">
            <small>Preview</small>
            <ConversationBody
              className={s.body}
              mentionClassName={s.mention}
              comment={{
                id: "draft",
                body: draft.body,
                authorId: identity,
                authorName: "You",
                createdAt: 0,
                deleted: false,
                mentions: api.members.map((member) => ({
                  uid: member.id,
                  displayName: member.displayName,
                })),
              }}
            />
          </div>
        )}
        <div className={s.actions}>
          <label htmlFor={memberId} className={s.memberLabel}>
            Mention
            <select
              id={memberId}
              value=""
              disabled={
                !loaded ||
                disabled ||
                busy ||
                Boolean(draft.pending) ||
                blockedRecovery ||
                locked
              }
              onChange={(event) => mention(event.target.value)}
            >
              <option value="">Choose a teammate…</option>
              {api.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <small>{draft.body.length}/4000</small>
          <button
            type="button"
            className={s.send}
            disabled={
              !loaded ||
              disabled ||
              busy ||
              Boolean(deleting) ||
              blockedRecovery ||
              locked ||
              Boolean(listenerError) ||
              (!draft.pending && !draft.body.trim())
            }
            onClick={() => void post()}
          >
            {busy
              ? "Sending…"
              : draft.pending
                ? "Retry same comment"
                : "Send comment"}
          </button>
        </div>
        {draft.pending && !busy && (
          <p className={s.hint}>
            This request is kept on this device. Retry uses the same message and
            identity, so a lost response cannot create a duplicate.
          </p>
        )}
        {draft.body && (
          <div className={s.recovery}>
            <span>
              Draft recovery is local to this browser. Clearing browser data
              removes it.
            </span>
            <button type="button" onClick={() => download(true)}>
              Download draft
            </button>
          </div>
        )}
      </div>
      <p className={s.announcement} role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
