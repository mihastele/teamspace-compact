# Collaboration verification and adversarial review

2026-10-04. Implemented bounded collaboration foundation; production acceptance remains open.

## Invariants and implementation

- UUID block identities never change or get reused. Separate permanent tombstones win over stale edits/moves. Concurrent block ordering uses maintained fractional keys, disjoint UUID-derived intervals and deterministic UUID ties; only moved/new blocks change positions.
- Y.Text applies incremental text deltas, including same-block typing. Formatting is one atomic register; independent type/level/checklist registers could otherwise merge into an invalid block.
- The server merges binary updates against current state in a membership-authorized transaction and validates materialized schema, identities, tombstones, dependencies and capacity. Operation receipts bind authenticated UID, generation, UUID and payload digest. Duplicate retries do not increment sequence.
- Binary updates are capped at 64KB; checkpoints at 350KB; combined checkpoint/materialized JSON at 800KB with Firestore metadata headroom. This implementation writes a bounded transactional checkpoint rather than an unbounded log. CRDT merge and transaction retries make replacement safe; document contention, request cost and finite history capacity remain explicit trade-offs. No compaction/generation reset is performed.
- Remote events reconcile local state without generating outbound mutations. Controller callbacks and subscriptions are scoped to an account/workspace/document. The controller reuses the existing workspace notes listener, with late-callback fencing, rather than adding a second note listener or one per block.
- An IndexedDB journal stores pending updates before transmission. Batches are bounded and dependency ordered. Exact sent bytes/IDs are frozen before sending; response-loss retry is idempotent. Atomic journal updates retain packets if acknowledgement bookkeeping fails. Web Locks fence duplicated-tab writers and remain held until queued journal writes drain. Closed-tab journals are reclaimed atomically when their writer lock is available.
- Saved means all local completed operations are acknowledged and journal bookkeeping is durable. Title/location saves have their own status/revision. Errors preserve recovery data and expose retry/Markdown export, including rejected document generations. Storage clear/denial is explicit; the browser must support IndexedDB, secure-context Web Locks and session storage.
- Collaborative Undo/Redo tracks local text, not snapshot replacement. Deletion clears text history. History actions buffer their updates until validation; a now-invalid undo restores the prior local checkpoint, clears history and reports the conflict without queuing corrupt state. Structural undo is not supported. Native IME input is buffered until composition ends; incomplete composition is not yet durable and triggers an unsaved-work warning.
- Presence uses trusted, membership-derived 90-second leases refreshed every 45 seconds. It is approximate, filtered on expiry and independent of document durability. Realtime Database native disconnect presence was evaluated; new cross-store membership infrastructure was unnecessary for this bounded approximation.

## Deterministic final-state coverage

| Scenario | Automated coverage |
| --- | --- |
| Different-block and same-block simultaneous edits | model, controller and real Firestore API |
| Simultaneous block creation and move/edit races | model and Firestore API; both model delivery orders |
| Delete versus stale editing/movement | model, controller and Firestore API; tombstones prevent resurrection |
| Duplicate events/requests and changed payload identity | controller no-write-loop, API replay/payload binding and simultaneous duplicate receipt |
| Temporary loss, rapid edits and reconnect after newer changes | controller durable outbox and model/API dependency ordering |
| Refresh during synchronization or after lost response | controller reopened journal, unchanged retry ID/bytes, one committed sequence |
| Document switch and late callback delivery | controller listener/timer teardown and scoped callback baseline rejection |
| Recovery storage and multiple tabs | real IndexedDB API via fake-indexeddb, scoped users/workspaces, active writer exclusion and closed-journal adoption |
| Server acknowledgement followed by local journal failure | controller retains retryable packet and recovers without a second server mutation |
| Malformed/oversized state, identity replacement and stale generations | atomic model/API rejection, explicit recovery copy |
| Membership, outsider and revoked access | default-deny rules and trusted API with clean emulators |

## Dedicated adversarial findings fixed

1. Whole snapshots, index identities and independent formatting fields could overwrite or corrupt concurrent state: stable IDs, incremental Y.Text and atomic formatting register.
2. A stale rendered input callback could remove newer text: generate its intent against the captured CRDT baseline, then merge into current state. A foreign-session baseline is rejected.
3. Offline batching could exceed update limits or omit dependencies: bounded ordered batches; missing dependencies fail before acknowledgement.
4. Invalid acknowledgements or failed journal removal could report Saved/discard a retry: verify acknowledged inclusion and generation, persist removal before dropping the in-memory packet.
5. Old pre-promotion/cache snapshots could poison a new session: ignore older legacy/sequence snapshots; reject genuine generation changes.
6. Disposal could release a recovery lock before delayed storage writes: drain queued persistence before releasing ownership. Closed-tab adoption uses atomic transactions and the same writer locks.
7. Undo could restore text into a remotely converted board or exceed history capacity: validate buffered history changes before any persistence and restore unchanged content on rejection. Model preflight retains deleted history while estimating size.
8. Note deletion could orphan receipts/leases after cleanup failure: fence the parent, clean subcollections first, then remove the parent; failures remain retryable.
9. Auth/listener races could restore a prior account's workspace or make Retry appear synchronized with a dead listener: guard auth responses and late snapshots; Retry restarts shared subscriptions and the controller.
10. IME partial text and old-document callbacks could be misapplied: stable textarea identities, composition baseline capture and hook scope fences. Actual browser acceptance is still required.

## Limits and acceptance still required

The checkpoint design targets small team documents. It does not prove large-team throughput or unlimited editing-history capacity. Simultaneous conversion to a textless board/divider versus text insertion can fail schema validation; pending work is retained with explicit recovery instead of dropping text. Completed operations recover after refresh; clearing browser storage can remove unacknowledged work, and unfinished native composition is not persisted until composition end. Approximate presence is not a connectivity guarantee.

No authenticated two-browser UI, caret/IME/mobile or deployed Google-authentication verification was completed. The previously recorded browser URL-security restriction remains a verification limitation; no alternative UI surface was used to bypass it. Firebase project setup is still missing. These are release gates, and the complete ticket's browser definition of done is not yet met. Emulator/controller tests are not substitutes for those checks.

Before release: deploy migration 004 rules/index exemptions/lease TTL and trusted routes before the client; provision Firebase; run two authenticated browsers through the ten ticket scenarios, including offline/reload and IME input; complete dependency/license review and observe CI. Record evidence and regressions here and in PROJECT-STATE.md.
