# 009 — Custom workspace board properties

Additive, lazy records; existing tasks and boards need no backfill. Deploy SQL 009
after 007/008 for Supabase, or updated Firestore rules for Firebase, before the new
client. The tracked migration runner includes 009. Never edit an applied migration.

- `workspaces/{id}/boardProperties/{uuid}`: name (1–80 characters), type
  (`text`, `select`, `multiSelect`, `date`), options (`id`, `name`), revision,
  server audit fields. At most 32 properties and 50 options per property.
- Workspace `boardPropertiesRevision` serializes concurrent definition creation,
  enforcing unique names and the cap. Definitions use expected-revision checks.
- Task `propertyValues`: optional UUID-keyed map of string, UUID array or null.
  Text is bounded at 2,000 characters; dates are valid YYYY-MM-DD calendar days.
  Select values must reference an existing option. Arrays cannot contain duplicates.
  Task updates merge only submitted keys inside the trusted transaction, preserving
  concurrent changes to other fields, including across retries.
- Property types and existing option identities are immutable. Names can change,
  options can be added. This iteration has no property/option deletion or date
  ranges, times, reminders, custom grouping, or calendar selection by custom date.
  Existing Due date remains the calendar source.

Maintained TypeScript models are updated in `src/lib/model.ts`; the JSON document
stores have no generated per-record schema. Both backends use the same validators
and member-authorized rate-limited trusted API. Firebase rules grant member reads
and deny all browser writes to definitions. SQL extends the existing member-read
RLS function; application tables remain RLS-enabled, direct SDK writes denied.
Root administrators do not gain content access without membership.

Download board JSON exports all currently loaded saved tasks and property
definitions, including stable IDs. Attachments and conversations are excluded.
Deleting a task deletes its values with the parent; definitions belong to the
workspace and are retained for the workspace lifetime. Full workspace/account
deletion and export remain existing open product features; no new automatic
retention policy or expiry is introduced.

Rollback the client/server together to stop new custom-field writes; retain
records/values so upgrading again restores them. Old task patches preserve
unknown stored fields. The former SQL read function can be restored with a new
forward migration if needed, denying direct definition reads. Never downgrade by
rewriting applied migration history or stripping existing task data.
