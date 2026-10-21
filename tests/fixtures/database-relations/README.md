# Database relation picker manual fixture

Run `npm run test:ui:database-relations` and open http://127.0.0.1:3120.
Stop with Ctrl+C. This renders the real picker in React Strict Mode with
60 synthetic targets, a selected archived entry and an unavailable selected ID.
No backend, environment files, editor locks, draft storage or saves are used.

Verify:

- Search `čEBELICA team`: only that available target plus the existing selections
  remain visible. Searching alone leaves Selected identities and Changes intact.
- Uncheck the unavailable entry; its identity disappears from the output.
  Remove Client 2, clear the search and confirm it cannot be newly selected.
- Fill to limit, search Client 50: it is disabled. Remove a selected entry;
  Client 50 becomes enabled and can replace it without exceeding 50 links.
- Simulate loading/failure: selected identities survive. Retry restores target
  names without resetting the query or selection.
- Archive target database: existing selections can be removed, new ones are
  disabled. Disable editing: checkboxes and Clear links cannot change selections;
  local search and retry remain usable.
- Search, Tab to a checkbox and Space to change it. Clear links removes all
  selections even while searching. An unmatched query with no selections shows
  No matching entries; Clear links is disabled.
- At 390px, search, long unavailable labels, checkboxes and Clear links fit
  without page/picker overflow. Reset the viewport afterward.

This is manual component acceptance, not an automated DOM suite or authenticated
database/editor/save/recovery acceptance. It reuses the established fixture's
installed Next internal webpack and TypeScript/CSS loaders; review that internal
bundler hook on Next upgrades. CSS source injection does not verify production
CSS module scoping. Generated bundles live in gitignored `.agentic/verification`.
