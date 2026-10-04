# Deployment backend selection

## Decisions and existing data flow

The administrator selects one backend for the deployment, not per workspace.
`BACKEND_PROVIDER` and the built browser's `NEXT_PUBLIC_BACKEND_PROVIDER` must
agree. Firebase remains the compatibility default. Provider selection does not
migrate accounts or existing content between installations.

The existing hook owns authentication, workspace collection subscriptions and
acknowledged optimistic overlays. All durable mutations go through the trusted
Next route. The server already performs membership checks, revision CAS,
idempotent operation receipts, Yjs merges, history capture and deletion fencing
inside Firestore transactions. Storage uses a separate two-phase reservation,
validation and private promotion flow. These semantics must survive the change.

## Implementation

1. Introduce a small typed transaction/query document-store interface and retain
   existing business rules in one implementation. Firebase uses its native
   transactions. Supabase stores path-addressed JSONB records with versions and
   commits through a service-only PostgreSQL function that validates the pinned
   global epoch for all reads (including negative queries) before applying writes atomically. Transaction callbacks
   retry conflicts. This conservative foundation favors correctness and schema
   compatibility; a serialized commit section trades peak write throughput for
   easier reasoning. It is not a new editor synchronization algorithm.
2. Use provider-specific authentication adapters and verified server identities.
   Keep existing Yjs journals, operation identities, generation fencing and
   UI acknowledgment behavior. Subscribe to collections, never individual
   blocks; reconcile snapshots after subscription/reconnect and fence disposed
   callbacks. SDK database writes stay denied.
3. Add email/password registration, sign-in, verification and reset alongside
   optional Google OAuth. `EMAIL_CONFIRMATION_REQUIRED` is a strict server
   boolean. Publish the same policy into database security configuration so
   direct reads cannot bypass it. Invalid or mismatched configuration fails
   closed. Auth providers also need corresponding administrative settings.
4. Adapt private attachment storage explicitly. Supabase cannot pretend to have
   GCS generation preconditions; bounded trusted upload/validation and private
   immutable promotion must preserve reservation and deletion protections.
5. Add a numbered PostgreSQL migration, default-deny writes and member-scoped
   RLS, transaction/authorization regressions, provider setup documentation and
   a clean-database test harness. Run existing Firebase tests as well.

## Self-hosting

`docker.compose.supabase.yml` includes the complete official self-hosted stack
at tag `self-hosted/v0.8.2`, peeled commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21`. Preparation fetches its required SQL
and gateway files into a gitignored directory and checks the exact commit.
The upstream project is Apache-2.0; downloaded license notices remain intact.
Service images retain upstream version pins. No credentials are committed.
Configuration generation uses Node's standard cryptography, aligns browser and
server JWT keys and refuses to overwrite an existing environment file.

## Acceptance

Assert final state under concurrent independent changes, duplicate operations,
phantom-query conflicts, membership revocation and deletion races. Verify RLS
on every application data table and private Storage isolation. Check email
verification for trusted routes and direct reads. Test upload size/content and
create-only behavior. Run lint, type checking, existing tests and build before
commit/push. Live OAuth, email delivery and two-browser acceptance require a
configured installation and remain separately reported deployment checks.
