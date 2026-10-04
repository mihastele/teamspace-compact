"use client";

import { useEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { Note, PageVersion, PageVersionSummary } from "@/lib/model";
import { exportNoteMarkdown } from "@/lib/note-export";
import { blockMarkdown } from "@/lib/markdown-shortcuts";
import MarkdownText from "./MarkdownText";
import s from "./PageHistory.module.css";

type Api = ReturnType<typeof useTeamspace>;
type RestoreRequest = {
  versionId: string;
  expectedRevision: number;
  operationId: string;
};
type HistoryProps = {
  api: Api;
  note: Note;
  blockedReason: string | null;
  onRestored: (note: Note) => void;
};

/** Key this action by account/workspace/note so navigation closes its modal. */
export function PageHistoryAction(
  props: HistoryProps & { className: string; disabled: boolean },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={props.className}
        disabled={props.disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        title="Preview saved versions and safely restore this page’s title and content"
      >
        History
      </button>
      {open && (
        <PageHistory
          api={props.api}
          note={props.note}
          blockedReason={props.blockedReason}
          onRestored={props.onRestored}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function failure(error: unknown) {
  return error instanceof Error
    ? error.message
    : "This request failed. Please try again.";
}
function date(value: number) {
  return new Date(value).toLocaleString();
}
function label(version: PageVersionSummary) {
  return (
    version.name ||
    (version.kind === "before_restore"
      ? "Before restore"
      : "Automatic checkpoint")
  );
}

/** Parent keys this modal by account, workspace and note, fencing asynchronous results. */
export default function PageHistory({
  api,
  note,
  blockedReason,
  close,
  onRestored,
}: HistoryProps & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancelRestore = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const busyGuard = useRef(false);
  const selectionRequest = useRef(0);
  const [versions, setVersions] = useState<PageVersionSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PageVersion | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [name, setName] = useState("");
  // This is deliberately not advanced by remote prop updates: it is the revision reviewed.
  const [reviewedRevision, setReviewedRevision] = useState(note.revision);
  const [reviewRejected, setReviewRejected] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(
    null,
  );
  const stale = note.revision !== reviewedRevision;
  const unavailable =
    blockedReason ||
    (stale || reviewRejected
      ? "This page changed. Refresh your review before saving or restoring a version."
      : null);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    heading.current?.focus();
    void api
      .listPageHistory(note.id)
      .then((result) => {
        if (cancelled || !alive.current) return;
        setVersions(result.versions);
        setNextBefore(result.nextBefore);
      })
      .catch((error: unknown) => {
        if (!cancelled && alive.current) setError(failure(error));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      cancelled = true;
      element?.close();
      if (prior?.isConnected) prior.focus();
    };
    // The parent supplies a scope key, so changing APIs does not refetch or reset review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (confirmRestore) cancelRestore.current?.focus();
  }, [confirmRestore]);

  async function loadMore(refresh = false) {
    if (busyGuard.current || loading || selecting) return;
    busyGuard.current = true;
    setLoading(true);
    setError("");
    const revision = note.revision;
    try {
      const result = await api.listPageHistory(
        note.id,
        refresh ? undefined : (nextBefore ?? undefined),
      );
      if (!alive.current) return;
      setVersions((previous) =>
        refresh
          ? result.versions
          : [
              ...previous,
              ...result.versions.filter(
                (v) => !previous.some((p) => p.id === v.id),
              ),
            ],
      );
      setNextBefore(result.nextBefore);
      if (refresh) {
        setReviewedRevision(revision);
        setReviewRejected(false);
        setConfirmRestore(false);
        setRestoreRequest(null);
      }
    } catch (error) {
      if (alive.current) {
        setError(failure(error));
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        )
          setReviewRejected(true);
      }
    } finally {
      busyGuard.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function select(version: PageVersionSummary) {
    if (busyGuard.current || restoreRequest) return;
    const request = ++selectionRequest.current;
    setSelecting(true);
    setSelected(null);
    setConfirmRestore(false);
    setError("");
    try {
      const result = await api.getPageVersion(note.id, version.id);
      if (alive.current && selectionRequest.current === request)
        setSelected(result);
    } catch (error) {
      if (alive.current && selectionRequest.current === request)
        setError(failure(error));
    } finally {
      if (alive.current && selectionRequest.current === request)
        setSelecting(false);
    }
  }
  async function saveNamed() {
    if (
      busyGuard.current ||
      loading ||
      selecting ||
      unavailable ||
      !name.trim() ||
      restoreRequest
    )
      return;
    busyGuard.current = true;
    setBusy(true);
    setError("");
    try {
      const version = await api.savePageVersion(
        note.id,
        reviewedRevision,
        name.trim(),
      );
      if (!alive.current) return;
      setVersions((previous) => [
        version,
        ...previous.filter((v) => v.id !== version.id),
      ]);
      setSelected(version);
      setName("");
    } catch (error) {
      if (alive.current) {
        setError(failure(error));
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        )
          setReviewRejected(true);
      }
    } finally {
      busyGuard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function restore(retry = false) {
    if (busyGuard.current || (!retry && (unavailable || !selected))) return;
    const request = retry
      ? restoreRequest
      : {
          versionId: selected!.id,
          expectedRevision: reviewedRevision,
          operationId: crypto.randomUUID(),
        };
    if (!request) return;
    busyGuard.current = true;
    setBusy(true);
    setRestoreRequest(request);
    setError("");
    try {
      const restored = await api.restorePageVersion(
        note.id,
        request.versionId,
        request.expectedRevision,
        request.operationId,
      );
      if (!alive.current) return;
      onRestored(restored);
      close();
    } catch (error) {
      if (!alive.current) return;
      setError(failure(error));
      // Explicit client rejections cannot have applied. Uncertain responses retain
      // the exact request so a lost acknowledgement is retried idempotently.
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? error.status
          : null;
      if (
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        setRestoreRequest(null);
        setConfirmRestore(false);
        if (status === 409) setReviewRejected(true);
      }
    } finally {
      busyGuard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function download() {
    if (!selected) return;
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      const exported = exportNoteMarkdown(selected.title, selected.content);
      url = URL.createObjectURL(
        new Blob([exported.markdown], { type: "text/markdown;charset=utf-8" }),
      );
      link.href = url;
      link.download = exported.filename;
      document.body.appendChild(link);
      link.click();
      setError("");
    } catch {
      setError(
        "Download could not start. Try again; the version is unchanged.",
      );
    } finally {
      link.remove();
      if (url) {
        const captured = url;
        setTimeout(() => URL.revokeObjectURL(captured), 1000);
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="page-history-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busyGuard.current) close();
      }}
    >
      <header className={s.header}>
        <div>
          <span className={s.eyebrow}>
            {api.configured
              ? "WORKSPACE HISTORY"
              : "THIS DEVICE · PREVIEW HISTORY"}
          </span>
          <h2 id="page-history-heading" ref={heading} tabIndex={-1}>
            Page history
          </h2>
          <p>{note.title}</p>
        </div>
        <button
          className={s.close}
          onClick={close}
          disabled={busy}
          aria-label="Close page history"
        >
          ×
        </button>
      </header>
      <div className={s.policy}>
        Automatic checkpoints: at most every five minutes, kept for 30 days.
        Named versions stay until this page is deleted.{" "}
        {api.configured
          ? ""
          : "Preview history is local to this browser; clearing browser storage removes it."}
      </div>
      <form
        className={s.save}
        onSubmit={(event) => {
          event.preventDefault();
          void saveNamed();
        }}
      >
        <label htmlFor="version-name">
          Keep a named version of the saved page
        </label>
        <div>
          <input
            id="version-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="e.g. Ready for review"
            disabled={busy || Boolean(restoreRequest)}
          />
          <button
            type="submit"
            disabled={
              busy ||
              loading ||
              selecting ||
              !name.trim() ||
              Boolean(unavailable) ||
              Boolean(restoreRequest)
            }
          >
            Save version
          </button>
        </div>
      </form>
      {unavailable && (
        <div className={s.notice} role="status">
          {unavailable}
        </div>
      )}
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {restoreRequest && !busy && (
        <div className={s.notice}>
          The restore response was not confirmed. Retry the same request to
          safely check whether it succeeded.
          <button onClick={() => void restore(true)}>Retry restore</button>
        </div>
      )}
      <div className={s.layout}>
        <aside className={s.list} aria-label="Saved versions">
          <button
            className={s.refresh}
            disabled={busy || loading || selecting || Boolean(restoreRequest)}
            onClick={() => void loadMore(true)}
          >
            Refresh review
          </button>
          {loading && !versions.length ? (
            <p role="status">Loading history…</p>
          ) : !versions.length ? (
            <p>No versions yet. Save a named version to keep this moment.</p>
          ) : (
            versions.map((version) => (
              <button
                key={version.id}
                aria-pressed={selected?.id === version.id}
                disabled={busy || Boolean(restoreRequest)}
                className={selected?.id === version.id ? s.active : undefined}
                onClick={() => void select(version)}
              >
                <strong>{label(version)}</strong>
                <time dateTime={new Date(version.capturedAt).toISOString()}>
                  {date(version.capturedAt)}
                </time>
                <small>
                  {version.capturedName}
                  {version.expiresAt
                    ? ` · Expires ${new Date(version.expiresAt).toLocaleDateString()}`
                    : " · Kept permanently"}
                </small>
              </button>
            ))
          )}
          {nextBefore !== null && (
            <button
              disabled={loading || busy || selecting || Boolean(restoreRequest)}
              onClick={() => void loadMore()}
            >
              {loading ? "Loading…" : "Load older versions"}
            </button>
          )}
        </aside>
        <section
          className={s.preview}
          aria-label="Version preview"
          aria-busy={selecting}
        >
          {selecting ? (
            <p role="status">Loading version…</p>
          ) : selected ? (
            <>
              <div className={s.previewHeader}>
                <div>
                  <span>{label(selected)}</span>
                  <h3>{selected.title}</h3>
                  <small>
                    {date(selected.capturedAt)} · {selected.capturedName}
                  </small>
                </div>
                <button onClick={download}>Download Markdown</button>
              </div>
              <div className={s.content}>
                {selected.content.blocks.map((block, index) =>
                  block.type === "board" ? (
                    <div key={block.id || index} className={s.board}>
                      Shared workspace board reference · board tasks are not
                      versioned here
                    </div>
                  ) : (
                    <MarkdownText
                      key={block.id || index}
                      text={blockMarkdown(block)}
                    />
                  ),
                )}
              </div>
              <div className={s.restore}>
                <p>
                  Restore replaces this page’s title and content. Its location,
                  subnotes, attachments and board tasks stay unchanged.
                  Teammates with stale edits must recover their work and reload
                  synchronization.
                </p>
                {confirmRestore ? (
                  <div
                    className={s.confirm}
                    role="group"
                    aria-label="Confirm page restore"
                  >
                    <strong>
                      Replace the current saved title and content?
                    </strong>
                    <p>
                      A recovery version of the current page is kept before
                      restoring.
                    </p>
                    <div>
                      <button
                        ref={cancelRestore}
                        disabled={busy || Boolean(restoreRequest)}
                        onClick={() => setConfirmRestore(false)}
                      >
                        Cancel
                      </button>
                      <button
                        disabled={
                          busy ||
                          Boolean(unavailable) ||
                          Boolean(restoreRequest)
                        }
                        onClick={() => void restore()}
                      >
                        {busy ? "Restoring…" : "Confirm restore"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    disabled={
                      busy || Boolean(unavailable) || Boolean(restoreRequest)
                    }
                    onClick={() => setConfirmRestore(true)}
                  >
                    Restore this version…
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className={s.empty}>
              <span aria-hidden="true">↶</span>
              <h3>A safe way back.</h3>
              <p>
                Select a version to preview its title and content before
                restoring.
              </p>
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
