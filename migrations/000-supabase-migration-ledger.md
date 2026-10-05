# Supabase migration bookkeeping

This administrative table tracks application SQL migrations for new self-hosted
installations. It does not migrate Firebase content or existing accounts between
providers. Run from the repository root after the Supabase backend is ready:

```sh
node scripts/migrate-supabase.mjs
```

The runner uses the database administrator inside the configured Compose `db`
service. It bootstraps `000-supabase-migration-ledger.sql` idempotently, then
applies 007 and 008 in order. The bootstrap is not itself a ledger entry. Each
application migration's receipt and schema changes commit in the same
transaction. A session advisory lock serializes competing runners. Failed
migrations roll back; previously completed migrations remain installed.

Checksums normalize CRLF to LF before SHA-256 hashing. Applied migration files
must remain unchanged; future schema changes need a new migration and an entry
in the runner's ordered list. Checksums detect edits, not malicious administrator
changes. Database administrators remain trusted.

## Existing installations

The runner refuses to infer a baseline when `teamspace_documents` already exists
without a 007 receipt. It also rejects changed checksums. Back up before upgrades.
If 007 was installed manually, apply 008 through the administrative SQL connection
following its guide. Automatic adoption of manually installed schemas is not
implemented. Do not delete tables or manufacture ledger entries to bypass this
check. Managed Supabase installations may continue using the documented manual
SQL path; this CLI specifically targets the self-hosted Compose deployment.

## Access control, types and retention

`teamspace_schema_migrations` has RLS enabled and all privileges revoked from
public, anon, authenticated and service_role, including the role that bypasses
RLS. Only administrative migrations read/write it. No browser/server application
model changes or regenerated SDK types are required for this operational table.

Rows contain migration filenames, checksums and server-generated application
times, without user content or credentials. They remain for the database's
lifetime and are included in administrative backups. They need no user export
or account-deletion action. Database deletion removes them.

The isolated PostgreSQL harness verifies clean installation, failed-migration
rollback, recovery, concurrent/repeated execution, checksum rejection, untracked
schema refusal and denied application-role access. It verifies RLS on the ledger,
document store and store state. Full-stack Auth/Storage and live two-user
acceptance remain separate deployment checks.
