# Page history and restore implementation plan

2026-10-04. User approved five-minute checkpoints retained 30 days, permanent named versions, and title/content-only restore. Implemented and automated verification passed; browser acceptance remains open. No live database has been changed.

## Existing architecture

Saved notes use member-authorized trusted transactions, materialized title/content, monotonic revision, a separate metadata revision and a Yjs generation/sequence. The workspace note listener is shared with the editor. Local preview uses an atomic browser-storage write and explicit Save. Note deletion fences new operations and recursively cleans existing subcollections before deleting the parent.

## Proposed history foundation

- Reuse trusted API, membership transactions and the current note revision; keep history immutable and server-written. List summary entries in bounded pages, fetch selected content separately, and avoid a listener per version or loading complete history with workspace notes.
- Approved policy: automatic checkpoints at most every five minutes of saved activity, with 30-day expiry; manually named versions retained until page deletion. Expiry is enforced when reading/restoring as well as eventual TTL cleanup. Never apply TTL to idempotency receipts.
- Snapshots contain sanitized materialized title/content, source revision, server identity/time, type and optional name. Historical CRDT bytes are not merged into the current document. Content-only snapshot serialization remains bounded below Firestore document limits. Add maintained TypeScript types, index exemptions and a numbered migration; no live database changed by hand.
- Snapshot capture belongs to the same transaction as the relevant durable edit. Failed/retried edits cannot create phantom or duplicate versions. Preserve the current saved page before restoring so a mistaken restore is recoverable.
- Restore must carry the revision the user reviewed and an operation UUID. Reauthorize inside the transaction, reject stale revision/deleting/missing/expired versions, update the page atomically and retain a private UID/payload-bound receipt for safe retry after a lost response. Restore must not resurrect a deleted page.
- Approved restore scope: title/content only; preserve parent, child pages, attachment bytes and shared board tasks.
- A restored collaborative page needs a fresh Yjs generation. Never rewind sequence or inject old clocks into the existing generation. Old-generation submissions must fail with explicit recovery rather than reintroducing pre-restore work. Clean viewers need a clear reload path; dirty/IME/offline viewers must retain/export their work. Existing generation fencing and empty-journal restart support this direction, but recovery/discard UX needs explicit implementation and tests before release.
- Own restore requires acknowledged content, no unsaved metadata/composition and explicit confirmation in the version preview. Concurrent edits after opening that preview produce a conflict, not silent replacement.
- Implement the same visible history controls in local preview with existing atomic persistence, revision checks and honest device-local labeling. Browser-storage quota failures preserve the previous page/history.
- History reads inherit workspace membership through trusted routes; direct browser writes remain denied. Parent deletion must recursively remove versions and restore receipts after fencing new operations, with retryable cleanup. Define snapshot Markdown export and workspace/account export/deletion implications in the migration.

## Verification and delivery

Assert final state for snapshot cadence/idempotence, named-version retention, expiry, read/restore authorization and revocation, successful restore, concurrent edit/restore, duplicate/lost-response restore, old-generation reconnect, missing/deleting pages, preservation of hierarchy/tasks/attachments, quota failure and deletion cleanup. Exercise clean emulator fixtures and security rules; run unit tests, lint, typecheck and production build. Browser two-user/IME checks remain an existing external gate and must not be claimed as tested.

Commit and push the complete verified history feature before implementing comments/mentions, as the user requested. Comments/mentions follow as a separate change; do not couple their schema or unfinished UI to the history commit.
