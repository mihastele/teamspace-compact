# 001 — Initial Firestore schema

Date: 2026-10-03. Baseline for a new, empty Firestore database.

Firestore is schemaless. There are no existing rows to transform in this baseline;
the typed application model and server validation define document shape. Deploy
`firestore.rules`, `firestore.indexes.json`, and `storage.rules` from `firebase.json`
before enabling the application. Later changes to stored document shape must add
another numbered migration with an idempotent transformation when needed.

## Collections and access control

| Path | Purpose | Browser reads | Browser writes |
| --- | --- | --- | --- |
| `users/{uid}` | Display profile | Own document only | Denied |
| `users/{uid}/workspaces/{id}` | Server-maintained membership lookup index | Denied; authenticated server lists own memberships | Denied |
| `workspaces/{id}` | Workspace name, owner, creation date | Members, document get only | Denied |
| `workspaces/{id}/members/{uid}` | Owner/member role and display name | Workspace members | Denied |
| `workspaces/{id}/tasks/{id}` | Kanban tasks | Workspace members | Denied |
| `workspaces/{id}/notes/{id}` | Rich notes and monotonic revision | Workspace members | Denied |
| `workspaces/{id}/attachments/{id}` | Parent and private object metadata | Workspace members | Denied |
| `invites/{tokenHash}` | Expiring, revocable invite usage | Denied | Denied |
| `rateLimits/{id}` | Short-lived abuse prevention counters | Denied | Denied |
| Any other path | Reserved, including server abuse counters | Denied | Denied |

The server repeats authorization because Firebase Admin bypasses rules. Membership
documents are never self-writable. Workspace lists are returned by the authenticated
server; the browser cannot query the global workspace collection or collection groups.
Tasks, notes, members, and attachment listeners query a single authorized workspace.
All Storage objects are inaccessible to browser SDKs; the server authorizes private
downloads and never relies on permanent public download tokens. Short-lived signed
upload URLs may write only to a server-generated staging path. The server validates
the staged file, verifies workspace membership again, and promotes it to the final
attachment path before creating metadata. Signed URLs bypass Storage rules, so their
expiration, fixed path, upload type, and final size/content checks are server obligations.
Failed promotion must remove staged/final objects; expired unclaimed staging objects
need a bucket lifecycle cleanup policy.

Composite collection indexes support attachment lookup by `parentId`/`parentType`
and active invitations by `workspaceId`/`revokedAt`. Single-workspace listeners and
direct document lookups use built-in indexes. Any new compound query must add its
index to `firestore.indexes.json`. Rate-limit counters use `expiresAt` TTL for eventual
cleanup; application enforcement checks the active minute independently of TTL timing.

Pending attachments also carry a 24-hour `expiresAt` TTL, removed upon successful
completion. Ready attachments never expire automatically. The one-day staging
bucket lifecycle remains necessary to remove abandoned objects independently of
Firestore cleanup. Images have a private `thumbnailPath` generated after bounded
decoding; thumbnails preserve transparency and stay within 400 pixels. Original,
staging and thumbnail objects are all removed on attachment/parent deletion.

## Export and deletion policy

Workspace content has no automatic expiration. Rate-limit counters expire shortly
after their minute window; staged uploads need one-day bucket lifecycle expiration.
A future self-service
export/deletion flow needs separate product authorization and end-to-end tests.
Until then, an authenticated operator must use the Admin SDK:

- Export an authorized workspace as JSON containing its workspace document and all
  member, task, note, and attachment documents; export referenced Storage bytes
  separately, preserving relative paths. Do not export invite hashes, abuse counters,
  credentials, or public download tokens.
- Delete a workspace by deleting its Storage prefix, all subcollections, workspace
  document, user membership index entries, and invitations referring to it. A parent document delete alone does
  not remove Firestore subcollections. Track failures so deletion can be retried.
- Deleting a task or note deletes its attachment bytes and metadata first. Failed
  object deletions must remain retryable rather than being reported as success.
- Account deletion removes the Firebase Auth user and profile, revokes membership,
  deletes the profile's workspace index subcollection, and resolves ownership before deletion. Shared authored content remains in its
  workspace until its owner deletes it; the operator must communicate that scope.

## Clean-database verification

Install the pinned development dependencies and Java 21, then run `npm run test:rules`.
The command starts fresh Firestore and Storage emulators under `demo-teamspace`;
the tests clear Firestore before each case, seed fixtures using disabled rules,
and verify every affected collection's member/nonmember access. They also exercise
client write denial, revoked membership, invite denial, unknown paths, and private
Storage denial. No real Firebase project or credentials are required.

On Windows, if Corretto Java 21 reports `Unable to establish loopback connection`
with `Invalid argument: connect`, set a process-only `JAVA_TOOL_OPTIONS` value of
`-Djdk.net.unixdomain.tmpdir=Z:\teamspace-nonexistent` (a nonexistent directory) before
running the test command. This makes the JDK's selector pipe fall back to TCP; do
not create that directory. The clean emulator suite was verified using this workaround.

Generated database types are not supported by Firestore; the application maintains
its TypeScript document types alongside validation. This migration is deployment
metadata, not a claim that production rules have already been deployed.
