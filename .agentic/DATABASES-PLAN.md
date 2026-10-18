# Independent databases and relations

2026-10-18: user prioritized database expansion over M4c and explicitly selected
adding databases alongside Tasks/Projects. Existing IDs and specialized task
behavior remain authoritative. PostgreSQL focus continues from the approved
October 17 architecture; Firebase/local preview retain their existing features.

First increment: named workspace databases, rich entry pages, ten typed property
kinds, multi-entry same/cross-database relations, derived incoming links, reviewed
saves, durable device-local draft/retry packets, reversible archives and
loaded-row JSON export with explicit truncation. Migration 016 extends member RLS and adds a
trigger-maintained FK relation projection. Existing transaction services, field
validators, block editor and Web Locks are reused; no dependency is needed.

The first table uses byte-bounded keyset pages, loaded-title search and
manual/first-page 30-second refresh. Database and entry edits use explicit Save; relation targets/types and
field/option identities stay immutable. Bounds and export/deletion policies are
in migrations/016-independent-databases.md. Tasks and Projects are not yet
relation targets in generic databases. Formulas/rollups and new saved layouts,
templates, comments/attachments and simultaneous editing remain future increments.

Verification: pure field/identity tests; disposable PostgreSQL persistence,
relation projection/FK validation, retry/CAS, archived/foreign links, RLS,
root deletion, clean/populated migrations; lint/typecheck/build; browser/manual
acceptance if an authenticated fixture is available. Never treat preview or a
successful build as evidence that live migrations or two-user flows passed.
