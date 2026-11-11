# Database task/project relation fixture

Run `npm run test:ui:database-entity-relations` and open
`http://127.0.0.1:3121`. This manual fixture renders the real database component
with synthetic in-memory API data. It never contacts a backend; saves last only
for the running fixture. Device-local draft slots on this dedicated origin may
persist between runs.

Check table/list task and project names and navigation, edit an entry, add and
remove a task link, confirm archived projects cannot be newly linked, save and
reopen, and add a relation property with each target kind. Check keyboard and a
narrow viewport as appropriate. Do not treat this fixture as authenticated,
two-user, migration or production-CSS acceptance. Its existing shared CSS loader
injects unscoped module class names, which can collide across components; it
reuses Next's internal webpack and needs review on Next upgrades.

Use **Open requested entry** to exercise the entry-opening handoff. Its synthetic
incoming task and project links invoke the fixture callbacks; a changed entry
draft should survive navigation and reappear when the entry is reopened.
