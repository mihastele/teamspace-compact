# 007 — Alternative Supabase backend and authentication policy

Apply `007-supabase-backend.sql` once to a **clean Supabase project**, using an
administrative database connection. The migration is atomic. It creates the
application schema, functions, Realtime publication entry and private default
bucket; it does not copy Firebase accounts, rows or files. Changing environment
variables is not a cross-provider migration. Existing Firebase installations
only need the new rules plus published auth policy, not this SQL.

## Data and transactions

`teamspace_documents` holds the existing path-addressed document model as JSONB
with a monotonically increasing version. Generated collection/workspace columns
support indexed subscription filtering. `teamspace_store_state` holds a global
epoch. Every successful mutation, recursive deletion and expiry cleanup takes
the epoch lock and increments it. Reads pin an epoch; the service-only commit
function refuses a changed epoch. The application retries the entire pure
transaction callback. Empty-query phantoms, missing rows and concurrent ancestry
checks therefore participate in conflict detection too.

Existing validation, membership checks, revision CAS, Yjs generations and
idempotent receipts remain shared with Firebase. Browser SDK writes and direct
service-role document writes are denied; service code mutates through the
privileged RPCs. Administrative content edits outside those functions would
break the epoch invariant and are unsupported. Function owners retain the
necessary database privileges; never reassign ownership to an untrusted role.
TypeScript document models remain the source for runtime shape validation;
there is no generated Firestore schema. Supabase rows retain those same types.

The global commit lock deliberately favors correctness over maximum throughput.
Unrelated workspaces can contend. Supabase collection reads use canonical API
snapshots, one workspace Realtime invalidation subscription, serialized responses
and five-second reconciliation for missed/deleted events and reconnects. This
bounded foundation targets small team workspaces; large snapshot payloads and
high write concurrency need pagination and partitioned epochs before scaling.
Polling, snapshots and API rate-limit writes have an ongoing cost.

## Authorization and email confirmation

RLS is enabled on **both** application tables. Authenticated users can read only
their own profile and member-authorized workspace data; history/operation
receipts, invitations, abuse counters and security configuration remain private.
Conversation/presence reads require their live parent. No client write policy
is added. Privileged transaction RPCs are inaccessible to anonymous and
authenticated clients. Direct service-role mutation is explicitly revoked.

`security/policy` is the single canonical read-policy document. A missing policy
requires confirmed email. Supabase RLS checks the verified `auth.users` record;
Firebase rules use the provider's signed `email_verified` claim. The trusted API
also validates the policy against `EMAIL_CONFIRMATION_REQUIRED` and rejects
mismatched deployments before accepting traffic.
Durable mutation transactions re-read that policy so a policy change participates
in their conflict detection and cannot be bypassed by an earlier auth check.

Publish it after configuring the server environment:

```sh
node --env-file=.env.local scripts/publish-auth-policy.mjs
```

For Docker's environment use `--env-file=.env.supabase`. Re-publish when changing
the confirmation setting; coordinate provider settings, rules and deployment
before accepting traffic. Supabase managed Auth's Confirm email setting must
match; the self-hosted Compose override derives mailer autoconfirm from the same
boolean. This cannot retroactively undo confirmation previously granted by
autoconfirm or a privileged administrator. Enable email delivery, password
policy, redirect allowlists and provider abuse limits. User metadata supplies
display names, never authorization identities.

## Storage and expiry

The default `teamspace-private` bucket is private with a 10 MiB cap and a JPEG,
PNG, WebP/PDF allowlist. No browser Storage policies are introduced. Use a clean
project or review existing policies before adopting this schema. Signed
create-only staging capabilities permit direct uploads; Supabase's fixed
two-hour upload token lifetime differs from Firebase's fifteen minutes. Exact
reservation length/type are enforced again during bounded server validation.
Object identity is checked before/after download; private final uploads are
create-only. Already issued download capabilities last at most sixty seconds.
The bucket cap permits a malicious reservation holder to upload a larger file
than its reservation within the absolute cap; it cannot be promoted as valid.

Schedule the following administrative command **hourly** with server variables
loaded (cron, a trusted job runner, or your deployment's scheduler):

```sh
node --env-file=.env.supabase scripts/prune-supabase.mjs
```

It removes expired automatic/before-restore history, presence, abuse counters
and pending reservations, then removes staging objects older than 24 hours.
Named versions, ready attachments and permanent operation receipts are retained.
The job is repeatable and does not delete ready attachment paths. It is a
required deployment step; the application does not claim a scheduler has been
installed merely by deploying its API. Expired history remains inaccessible even
before cleanup. Monitor job failures without logging keys or content. Firebase
continues using its existing TTL policies and bucket lifecycle rule.

## Export, deletion and verification

Page/task deletion uses the same fenced cleanup of child collections and private
files as Firebase. Markdown exports continue working for notes, versions and
visible conversations. Full workspace/account export and deletion remain the
existing open product features. Back up PostgreSQL, private object storage and
server configuration together. Rollback cannot point Firebase at Supabase data.

`npm run test:supabase` creates a fresh isolated PostgreSQL 17 container, applies
the SQL from scratch and tests real locking, RLS, CAS retries and final domain
state. It uses minimal Auth/Storage schema fixtures, not a deployed GoTrue,
PostgREST or Storage service. SDK/storage adapter tests cover wire contracts;
live email/OAuth delivery, deployed CORS, the complete Docker stack and two-user
browser acceptance remain release checks. `npm run test:rules` separately covers
the existing Firebase backend and confirmation policy.
