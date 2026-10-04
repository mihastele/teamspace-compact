# Real-time collaboration implementation plan

Date: 2026-10-04. Status: bounded implementation built and tested; browser/deployed acceptance remains open.

## Existing architecture and data flow

- Next.js App Router serves a React textarea-based block editor and Firebase Admin route handlers on Vercel. Firebase Authentication uses Google sign-in; server ID-token verification supplies trusted identity.
- `useTeamspace` owns four workspace-scoped Firestore listeners: tasks, notes, members and attachments. Cleanup unsubscribes all four. Browser writes are denied by rules; member-authorized server transactions perform mutations.
- Notes store title, parentId, revision and an array of typed blocks. Blocks have no persistent identity. The editor uses array indices for keys, selection, focus, insertion and movement.
- Local user input updates memory-only drafts immediately. Save sends the entire note through `mutateNote`; a transaction compares expectedRevision before replacing content. Teammates receive the saved snapshot. Clean drafts follow it; dirty drafts retain their baseline and show conflict.
- Revision checks prevent silent whole-note overwrite but do not merge independent edits. No durable local outbox exists. Refresh loses unacknowledged drafts. Preview mode stores device-local content and must not be represented as authenticated collaboration.
- Undo is a local snapshot history, cleared on remote replacement. This must change for collaborative notes: replaying old snapshots could undo another user's work.
- Tests cover pure validation/editor helpers, actual Markdown rendering, authorization rules and real Firestore transaction behavior with emulators. There is no persisted browser automation suite or deployed two-user verification.

## Proposed architecture

Yjs is justified by the requested Notion-like simultaneous editing, including same-block typing. Its text updates merge without relying on client wall clocks and are idempotent under duplicate delivery. Firestore remains durable storage; existing trusted routes remain the authorization and validation boundary. Do not introduce a separate WebSocket service for the initial foundation.

1. Promote legacy notes exactly once in a server transaction. Assign immutable block UUIDs and create a versioned collaborative state. Never let different browsers initialize divergent identities from the same legacy array.
2. Bind text edits to Y.Text incremental insert/delete operations. Maintain immutable block identities and explicit permanent deletion tombstones. Use local transaction origins to distinguish user edits from remote delivery. Remote updates never enter the persistence queue.
3. Choose and test a deterministic ordering representation before implementation. Do not use array indices as shared positions or move Y.Array elements through delete/reinsert. A position per block plus immutable-ID tie-breaking is a candidate; numeric midpoint exhaustion and concurrent moves must have a defined safe response. Do not silently rebalance stale positions. Evaluate maintained fractional-ordering implementations before adding any dependency.
4. Extend trusted routes for initialization, updates and metadata changes. Updates include a stable operation UUID and bounded binary payload. The server merges against current state inside a transaction, reauthorizes membership, validates decoded structure and materialized content, writes a monotonic sequence and durable receipt, then acknowledges.
5. Receipts bind authenticated identity, document generation, operation ID and payload digest. Reuse with a different payload fails. Response-loss retries return the original acknowledgement without mutation. Deleting/missing documents reject updates and must never be recreated by an upsert. Receipt retention and generation fencing must prevent delayed replay after compaction/deletion.
6. Fence old whole-content PATCH requests after promotion. Title and hierarchy changes retain explicit trusted revision checks; hierarchy transactions preserve existing cycle/delete protection. Reuse materialized content for Markdown export and search.
7. Introduce one per-document controller and durable IndexedDB outbox, scoped by authenticated user/workspace/document generation. Persist pending work before sending, serialize/retry unchanged operation identities, and recover after refresh. Storage failure must be explicit. Reconcile acknowledged state plus pending local operations rather than replacing local state with snapshots. Clean up listeners, timers and callbacks with generation guards on document/auth changes.
8. Expose Saving, Saved, Offline, Syncing and Sync failed from controller state. Saved means all relevant local updates have server acknowledgements, not merely that a cache snapshot arrived. Preserve failed work with retry/export recovery. Replace snapshot undo with local-origin collaborative undo; structural deletion semantics must be reconciled with permanent tombstones.

## Performance, presence and limits

A bounded Yjs checkpoint stored transactionally is the smallest coherent foundation, but rewriting a checkpoint/materialized note introduces contention and size limits. It is safe only if updates merge rather than replace stale state, and the implementation explicitly measures/enforces size and update frequency. This is not evidence of large-team scalability. Before accepting it, compare incremental durable update records plus atomic checkpoints, define replay/compaction correctness and demonstrate recovery from concurrent compaction. Do not silently ship an unbounded log or Firestore document.

Firebase Realtime Database offers native disconnect presence, but adding it requires membership authorization across stores and new deployment configuration. Evaluate this against bounded Firestore leases with server-issued expiry; presence is approximate, ephemeral and never proof of content durability. Do not add per-keystroke heartbeats or mix presence into note revisions. Presence failure must not prevent saving.

Security rules remain default-deny for client writes. Any new readable collection needs member-scoped authorization and tests for outsiders, revoked membership and foreign workspace access. Server receipts may remain private. Validate CRDT input before persistence, enforce decoded/materialized size limits, and do not log document text or binary payloads. Large/malformed updates and dependency gaps must fail without discarding the local recovery copy.

## Incremental execution and verification

1. Finalize shared model/ordering/transport contract; check exact dependency versions, licenses and maintenance before installation. Record migration 004, maintained types, export/deletion and rollout/rollback implications.
2. Implement pure collaborative model and deterministic adversarial delivery harness before connecting UI.
3. Implement trusted transactions and receipts; verify clean emulator migration, authorization, schema limits, deletion and legacy-client fences.
4. Implement durable outbox/controller and stable-ID editor binding, then collaborative undo and status/recovery UI. Avoid replacing the current editor or duplicating workspace abstractions.
5. Add presence only after evaluating deployment/security requirements. Document its approximation and cost.
6. Assert final state for different-block edits, same-block typing, simultaneous inserts, move/edit races, deletion/stale edits, duplicate events, network loss, reconnect after remote changes, rapid edits, refresh during acknowledgement and document listener teardown. Vary delivery order and operation retry order, including lost HTTP responses.
7. Run existing unit, emulator/rules/API, lint, typecheck and production build checks. Add two-browser acceptance with authenticated emulator users; deployed Google authentication remains a separate configuration-dependent check.
8. Perform a dedicated adversarial review: worst permitted event ordering must not lose, duplicate, resurrect or corrupt blocks. Add a regression for every concrete issue, then rerun relevant checks.

## Remaining gates

The earlier usage-limit stop was resumed with user authorization. The bounded implementation and additive migration 004 now exist; no live database was changed. See COLLABORATION-VERIFICATION.md for implemented decisions, adversarial fixes and limitations. Firebase provisioning, deployed two-user/browser acceptance, licensing and dependency audit review remain release gates. The browser definition of done is not yet met.

Primary references consulted: [Yjs document updates](https://docs.yjs.dev/api/document-updates), [Yjs introduction](https://docs.yjs.dev/), [Firebase presence](https://firebase.google.com/docs/firestore/solutions/presence), and [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).
