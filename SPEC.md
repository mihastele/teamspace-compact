# Teamspace — hackathon build spec

## Purpose
A small shared workspace for a college team: track work on a Kanban board and keep project notes beside it. Prioritize reliable saving, clear permissions, and quick navigation.

## Agreed stack
- Next.js App Router, React, TypeScript; deploy to Vercel.
- Firebase Authentication: Google sign-in.
- Cloud Firestore: workspaces, membership, tasks, notes, attachment metadata.
- Firebase Storage: private attachments. Requires Blaze billing.
- No MinIO or separate object-storage server.
- Plain CSS for the first slice; reusable design tokens and components.

## Tonight's scope
1. Sign in, create a workspace, invite teammates by a shareable token, join a workspace.
2. One board per workspace with To do, In progress, Done.
3. Create, edit, delete, assign, and move tasks. Optional due date and description.
4. Create, edit, and delete notes with headings, bold, lists, and links.
5. Shared task updates through Firestore listeners. Notes use explicit Save and revision checks; conflicting saves must never silently overwrite another person's work.
6. Upload images and PDFs to tasks or notes; view and delete attachments.
7. Responsive interface, loading/empty/error states, keyboard-accessible controls.

No simultaneous text editing, nested pages, custom databases, AI, notifications, public publishing, or complex role hierarchy tonight.

## Main screens and behavior
- Sign-in: Google button; actionable authentication errors.
- Workspace: sidebar with workspace name, Board, Notes, and Members.
- Board: three columns, task count, Add task. Card shows title, assignee, due date. Detail editor holds description and attachments. Drag moves a card; a status selector provides keyboard/touch fallback.
- Notes: document list and editor; visible Saved, Unsaved, Saving, or Failed state. Save is explicit. If the remote revision changes while editing, keep the local draft and offer reload/copy instead of overwriting.
- Members: member list and invite link. Owner can revoke an invite or remove a member. Members can leave; the last owner cannot leave without transferring ownership.
- Missing Firebase configuration: clearly labeled local prototype. No claim of shared data or authenticated access.

## Design
Compact white working surface, dark navy navigation, cobalt actions, subtle borders, readable typography. Open directly on the board. Task details appear in a dialog. On mobile, navigation collapses and columns stack. Respect reduced motion and visible focus.

## Data model
All timestamps are server timestamps; identifiers are generated IDs.

| Path | Fields |
| --- | --- |
| users/{uid} | displayName, photoURL, createdAt |
| workspaces/{id} | name, ownerId, createdAt |
| workspaces/{id}/members/{uid} | role: owner/member, displayName, joinedAt |
| workspaces/{id}/tasks/{id} | title, description, status: todo/doing/done, assigneeId or null, dueDate: YYYY-MM-DD or null, position, createdBy, createdAt, updatedAt |
| workspaces/{id}/notes/{id} | title, content: editor JSON, revision, createdBy, createdAt, updatedAt, updatedBy |
| workspaces/{id}/attachments/{id} | parentType, parentId, storagePath, originalName, contentType, bytes, uploadedBy, createdAt |
| invites/{tokenHash} | workspaceId, createdBy, expiresAt, revokedAt or null, maxUses, uses |

Only a trusted server creates/redeems invitations. Validate Firebase ID tokens, check membership, and update membership/invite usage in a transaction. Use random high-entropy tokens; store hashes. Do not make membership self-writable through client rules. Admin SDK bypasses rules, so server handlers must repeat authorization checks.

## Security and collaboration
- Default-deny Firestore and Storage rules.
- Only authenticated workspace members can read/write that workspace's tasks, notes, and attachments.
- Workspace/membership administration is owner-only through trusted server handlers.
- Validate allowed fields, lengths, status values, immutable creator fields, and assigned membership.
- Notes save through a transaction that checks the expected revision and increments it.
- Firestore listeners subscribe only to the active workspace and unsubscribe on navigation/sign-out.
- Render editor content safely; reject unsafe link protocols. Never render unsanitized HTML.
- Keep Admin SDK secrets in server environment variables. NEXT_PUBLIC Firebase configuration is client configuration, not an authorization boundary.

## Attachments and compression
- Initially accept JPEG, PNG, WebP, and PDF; maximum source file 15 MB, stored file 10 MB. Validate again in rules/server as appropriate.
- Photos: preserve aspect ratio, cap longest edge at 2,048 px, no upscaling, WebP quality 0.82 starting point; thumbnail capped at 400 px.
- Text screenshots/diagrams: retain PNG to keep text sharp. Explicit Keep original option, subject to file limit.
- Preserve transparency and verify orientation. Compression quality is a target, not a promise of identical detail. PDFs remain unchanged.
- Storage path: workspaces/{workspaceId}/{parentType}/{parentId}/{attachmentId}/{filename}.
- Private authenticated downloads. Do not save permanent public download tokens as the access-control mechanism.
- Do not embed image binaries in Firestore. Delete orphaned uploads after failed metadata writes; delete Storage objects when removing attachments.

## 195-minute sequence
| Minutes | Deliverable |
| --- | --- |
| 0–20 | Spec, starter, board layout, Firebase project setup |
| 20–65 | Authentication, workspace creation/joining, membership rules |
| 65–110 | Persisted task editing/moving and shared updates |
| 110–150 | Notes editor, save state, revision conflict handling |
| 150–170 | Attachments and image compression |
| 170–195 | Permission checks, mobile checks, build, Vercel deployment, two-user smoke test |

If time runs short, defer attachments first; label incomplete work explicitly. Never substitute device-local data for shared team functionality.

## Acceptance checks
- Two signed-in members see a task move without refreshing.
- Refresh preserves tasks and notes.
- A nonmember cannot read or mutate workspace data or files, even using SDK calls directly.
- Expired/revoked invites fail; owner-only operations reject regular members.
- Concurrent note saves raise a conflict and preserve the losing user's draft.
- Failed saves/uploads show errors and retain user input.
- Task status can be changed without dragging; dialog has keyboard focus handling.
- Compressed photos and screenshot text remain usable; oversized/unsupported files fail clearly.
- Production build passes; authentication works on the deployed authorized domain.

## Current implementation milestone
Start with a clearly labeled local board prototype: create/edit/delete cards and move status, plus a notes draft surface. This is the first visual slice, not the finished collaboration system. Connect Firebase in the next milestone after project configuration is available.
