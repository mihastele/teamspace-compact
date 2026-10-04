# 008 — Workspace administration and development enrollment

Apply `008-workspace-administration.sql` after 007 on Supabase before enabling
direct addition by email. Firebase needs no SQL or rule changes. Existing owner
and member rows remain valid without backfill. Maintain the TypeScript member
model with the additive `admin` role; there is no generated Firestore schema.

Workspace owners and root admins may appoint/demote workspace admins. Workspace
admins may create/revoke invitations, add registered accounts and remove ordinary
members. They cannot promote themselves, change another admin or alter owners.
Only the owner transfers ownership. Root administration grants access-management
capabilities across workspaces, not automatic membership or private content reads.

`ROOT_ADMIN_UIDS` is an exact comma-separated server account-ID allowlist. Root
status cannot be assigned through workspace roles, user metadata or public
configuration. Changing it requires restarting/redeploying the server. Remove
IDs to revoke root authority. A root admin may explicitly add their own account
as a member when access to a workspace's content is intended.

Direct addition resolves an existing active provider account by email or ID after
authorization and rate limiting, then reauthorizes in the committing transaction.
Unregistered, disabled, banned, deleted or anonymous Supabase accounts are not
accepted. No account or password is created and email is never marked confirmed.
Firebase lookup uses Admin Auth; Supabase's narrowly scoped service-only function
maps email to a unique auth ID, then Admin Auth validates the account. No public
directory, auth-schema exposure or paginated SDK user-list fetch is introduced.
At large account counts, review the email lookup query plan: case-insensitive SQL
lookup can scan Auth rows if the provider lacks a matching normalized-email index.
This migration does not add custom indexes to the provider-managed Auth schema.

New JSON shapes:

- `workspaces/{id}/members/{uid}`: role `admin` in addition to existing roles;
  direct additions record `addedBy`; role changes record `roleUpdatedBy` and
  server `roleUpdatedAt`.
- `workspaces/{id}/membershipOperations/{actorUid_operationId}`: private permanent
  retry receipt containing the account-query digest, target UID, actor UID and
  server creation time. Replaying after removal acknowledges the previous request
  without recreating membership; changed queries cannot reuse an operation ID.
- `users/{uid}/developmentEnrollments/{workspaceId}`: private server enrollment
marker with server `enrolledAt`. Once-only auto-join does not undo removal/leave.

Removal/leave in the configured development workspace also creates the marker
when absent, preventing rejoining even if the account never bootstrapped before.

`DEV_AUTO_JOIN_WORKSPACE_ID` must reference an already created workspace and is
accepted only when `NODE_ENV=development`. Production rejects a nonempty setting.
Development sign-ins call the trusted bootstrap after satisfying email policy;
membership, account index, profile and marker commit together. Existing owners
and admins retain their roles. Membership is capped at 100 workspaces per account.

RLS remains enabled on both Supabase application tables. Existing read policies
deny enrollment/operation records and all SDK writes, including root/admin users.
The new RPC has an empty search path and revoked PUBLIC/anon/authenticated execute
privileges; only service_role can call it. No rule relaxation is required on
Firebase. Clean PostgreSQL migrations and emulator fixtures verify these shapes.

Export/deletion: existing page/conversation exports do not include private access
metadata. Full workspace/account export/deletion remains the existing open
feature; it must include/remove membership indexes, enrollments and operation
receipts. Membership removal deletes the account workspace index and unassigns
tasks, retaining the private enrollment marker and receipt to prevent stale
rejoining. Receipts/markers have no automatic expiry. No live database is modified
by implementation or tests. Rollback removes the new UI/routes; explicitly demote
admin rows through supported APIs first if returning to owner-only administration.

Acceptance limits: root workspace listing shows at most 1,000 rows, explicitly
flags truncation and accepts a known workspace ID. Added users can refresh their
workspace list or sign in again; no email/notification is sent and no background
account-membership poll is installed. Pending addition identities survive Retry
within the form, not refresh; acknowledged membership and receipts are durable.
Actual Auth directory/email, root UI, focus/mobile and two-user acceptance require
configured providers and remain separate from isolated database evidence.
