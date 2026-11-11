# 020 — Task and project backlinks on database entries

Updates the existing service-only database-entry read to include task and
project links from migration 019's indexes. The existing entry-to-entry backlink
shape and 200-item limit are unchanged. Task/project links use an independent,
deterministically ordered limit of 200 and expose a separate truncation flag.
Deleting tasks are hidden; archived projects remain visible and labelled.

The read rechecks workspace membership, published confirmation policy and the
actual Auth confirmation record. Existing index RLS remains enabled and direct
application-role writes remain denied. This migration changes no stored rows or
table shape; catalog-generated row types are unchanged. Workspace deletion and
exports retain the 019 policy. Staging is not migrated by a development build.
Deploy this migration with the matching API/client and verify a backup/restore
and authenticated two-user behavior before rollout.
