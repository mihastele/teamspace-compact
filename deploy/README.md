# Staging and production

Both environments run optimized production images and an isolated, pinned
self-hosted Supabase stack. Staging uses separate keys, database, uploads,
containers, network and ports; no production data is copied. Existing
`.env.supabase` and the legacy Compose stack are not changed.

Requirements: Git, Node 22.13+ or 24, and Docker with Compose 2.24.4+.
Run commands from the repository root on your deployment host. Start with
`npm ci`. The first setup fetches the existing pinned Supabase configuration.

## Generate configuration and secrets

```sh
npm run deploy:setup -- staging
npm run deploy:setup -- production --site-url https://notes.your-domain.com --api-url https://api.your-domain.com
```

This creates `deployments/staging/` and `deployments/production/`, each containing
its own standard `compose.yaml`, private `.env`, pinned Supabase configuration
and future data directories. Without URL options, production gets explicit
`example.com` placeholders; `doctor` refuses to launch until you replace them.
Staging defaults to `http://localhost:3100` and `http://localhost:8100`.
Production defaults to loopback ports 3000 and 8000. Override host ports at setup
with `--web-port` and `--api-port`. Internal PostgreSQL stays on 5432 and is not
published on the host.

The generator uses Node's cryptographic random generator for database/dashboard
passwords, JWT signing secrets, aligned anon/service-role tokens, encryption
keys and internal S3 credentials. Optional asymmetric key settings remain
unused; the pinned stack uses its supported HS256 configuration. Never run setup
to rotate keys: it refuses an existing directory. Existing deployment files,
keys and data are never overwritten. An interrupted setup leaves its directory
for inspection rather than guessing which files are safe to replace.

External credentials intentionally stay blank. Edit only the selected
environment's `.env`:

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_ADMIN_EMAIL`
  for production confirmation and password-reset mail. Staging defaults to
  the local captured-mail service described below.
- Google OAuth is optional and disabled. To enable it, provide `GOOGLE_CLIENT_ID`
  and `GOOGLE_SECRET`, then set `GOOGLE_AUTH_ENABLED=true` and configure the exact
  callback `<API origin>/auth/v1/callback` in Google.
- `OPENAI_API_KEY` is blank; no paid agent/model service is enabled or needed.
- `ROOT_ADMIN_UIDS` stays blank until you choose registered deployment-admin IDs.
  The first workspace creator still becomes its workspace owner.

Email confirmation remains required by default in both environments. Setup does
not silently relax authentication for staging. `doctor` lists missing email
settings by name without printing values. External API credentials cannot be
generated locally. Quote values containing `$`, `#`, spaces or quotes according
to dotenv syntax; simple single-quoted passwords preserve literal dollar signs.

## Staging email inbox

New staging profiles include pinned Mailpit mail capture. Email confirmation
remains required; open confirmation/reset messages at `http://localhost:8025`.
Mail is captured locally and never delivered to real recipients. Only the inbox
HTTP port is published, on loopback; SMTP port 1025 stays inside Docker. Do not
publish the inbox through your public reverse proxy: it contains sign-in links.
Messages are held in the container (up to 500) and disappear when it is replaced.
The inbox is a staging aid, not a production mail provider.

For a staging profile generated before local mail support, run once:

```sh
npm run deploy -- staging mail-local
npm run deploy -- staging up
```

This updates only staging SMTP settings and adds `mail-local.yaml`; internal
keys, database files and confirmation policy are retained. It refuses production
and refuses to replace an existing external SMTP host unless you explicitly
clear `SMTP_HOST` first. New profiles are already configured. The wrapper loads
the extra Compose file whenever staging's `SMTP_HOST=mailpit`. To use real SMTP
instead, replace all staging SMTP settings; the wrapper omits local capture.
Port 8025 is reserved for the inbox and must be free on the host.

Mailpit is MIT licensed and actively maintained; its version and image digest
are pinned. See [official Docker documentation](https://mailpit.axllent.org/docs/install/docker/)
and [license](https://mailpit.axllent.org/docs/development/).

If editing URLs later, keep `SITE_URL` and `APP_URL` equal to the website origin;
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` and `SUPABASE_PUBLIC_URL` equal to the
API origin; `API_EXTERNAL_URL=<API origin>/auth/v1`; and
`ADDITIONAL_REDIRECT_URLS=<website origin>/`. The doctor catches mismatches.
Rebuild after changing public URL/anon settings: Next.js embeds them at build time.
Keep `COMPOSE_PROJECT_NAME`, internal database settings and directory identities
unchanged. `RELEASE_TAG` defaults to `local`; set a unique image tag for a release
if you want to retain previous images.

Generated files are excluded from Git and Docker build context. POSIX secret
files use mode 0600 and deployment directories 0700. Windows uses inherited ACLs;
restrict the deployment directory to its operator/service account. Keep an
encrypted, access-controlled copy of the `.env` separately from the server.

## Check, build and start

```sh
npm run deploy -- staging doctor
npm run deploy -- staging build
npm run deploy -- staging up
```

Replace `staging` with `production` for production. `build` works before external
mail credentials are filled in; it builds the optimized image without starting
services or migrating a database. Only public settings enter build arguments.
The doctor validates aligned keys, URLs, flags, private bindings and the real
Compose model. Commands fence inherited shell/Compose settings so one
environment cannot accidentally borrow the other's credentials.

`up` builds first, stops the selected web/cleanup writers, waits for the selected
backend services, takes a private PostgreSQL dump, applies tracked migrations,
publishes the matching authentication read policy, then starts the matching
website and hourly expiry/staging-cleanup container. Existing applied migration
checksums are preserved; failed numbered migrations are not recorded as applied.
No invitation, email, user or workspace is created automatically.

The same command updates that environment after `git pull`. If a backend,
backup or migration fails, website/cleanup may stay stopped; earlier successful
migrations remain applied. The command reports that state. Preserve the data,
inspect the private configuration and backup, and correct the failure before
retrying. For a manually migrated legacy database, follow the existing manual
upgrade guide rather than copying its data directory into this new tracked stack.

## HTTPS and external access

The setup publishes only website and gateway ports on `127.0.0.1`. Put an HTTPS
reverse proxy on the same host in front of both origins, for example:

```caddyfile
notes.your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
api.your-domain.com {
    reverse_proxy 127.0.0.1:8000
}
```

Use staging's 3100/8100 ports for its separate HTTPS domains. Configure DNS and
TLS on that proxy yourself; this tool does not install a proxy, open a firewall
or obtain certificates. A proxy in Docker must share the appropriate network
and route to `web:3000` / `api-gw:8000`; its own loopback is not the host's.
Preserve forwarding headers, WebSocket upgrades and upload limits of at least
10 MiB. Do not expose Studio/database administration publicly; restrict admin
routes on the API reverse proxy as appropriate for your installation.

## Operations and recovery

```sh
npm run deploy -- production status
npm run deploy -- production backup
npm run deploy -- production prune
npm run deploy -- production stop
```

`stop` retains containers, database, uploaded files and keys. There is no reset
or volume-delete command. `prune` uses the existing authorized expiry/abandoned
staging cleanup, not deletion of saved attachments. Cleanup also runs on startup
and hourly while the stack runs; failures emit a sanitized message and retry in
an hour. Monitor those messages. Retention defaults remain unchanged.

Database backups go to `~/.teamspace/backups/<environment>/` outside the repo,
with private permissions; failures leave a clearly unusable partial dump and
abort migration. A dump contains sensitive user/auth data: protect it, encrypt
off-host copies, set a backup-retention policy and test restoration. **Database
dumps do not contain uploaded file bytes or encryption keys.** Back up the
environment's `.env`, `supabase/volumes/storage`, `supabase/volumes/db/data` and
Docker's environment-scoped `db-config` volume using a consistent snapshot or
while services are stopped. Do not copy live PostgreSQL files as a backup.

`npm run deploy -- production migrate` is an advanced coordinated step: it
stops writers, starts/waits for the backend, backs up and migrates/publishes
policy, and leaves website/cleanup stopped. Follow with `up` to deploy a matching
client/API. Schema rollback requires a reviewed reverse migration or tested
backup restoration with writers stopped; restarting an older image alone does
not reverse migrations. Key rotation and moving an existing installation are
separate planned operations, never a setup rerun.

For direct Compose operations, enter the chosen deployment directory and use
`docker compose --env-file .env -f compose.yaml ...` in a clean shell. Prefer the
wrapper because shell variables override dotenv values in plain Compose. For
staging with captured mail, direct Compose also requires `-f mail-local.yaml`
after `-f compose.yaml`. Do not
paste `docker compose config` output into logs: it resolves private credentials.
The wrapper suppresses raw build/SQL/Compose failure output for the same reason.

### When `up` stops

If the command lists missing `SMTP_*` settings, it stopped during preflight,
before building or starting services. For an older staging profile, use
`npm run deploy -- staging mail-local` to enable the local inbox. Otherwise edit `deployments/<environment>/.env`
with your mail provider's settings, run `doctor`, then retry `up`. Generated
staging credentials do not include an external SMTP account. Email confirmation
requires mail delivery; a successful image build alone does not make signup ready.

Startup reports the build, backend, backup/migration and website stages. Docker
failures identify common daemon, port, registry and health problems without
printing raw child output. For an unhealthy service, run
`npm run deploy -- staging status` (or `production status`) and inspect that
service's logs privately on the deployment host. Do not paste unredacted logs
or resolved Compose configuration into a public issue.

Automated evidence covers generation, overwrite protection, isolation, config
and image/runtime checks. A healthy container does not establish release
acceptance. Verify public HTTPS, actual mail delivery, OAuth if enabled, private
uploads/downloads and authenticated two-user access on each deployed environment.

To repeat the deployment checks, run `npm test` and `npm run test:deployment`
after preparing the pinned source. After building both generated environments,
`npm run test:deployment:image` checks their unprivileged HTTP runtime, cleanup
dependencies, embedded public settings and absence of private/cross-environment
keys in the images. Test containers have no external network access.

Reference behavior: [Docker Compose include](https://docs.docker.com/reference/compose-file/include/),
[Compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation),
and [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker).
