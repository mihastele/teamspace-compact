# Task/project data-source relation fixture

Run `npm run test:ui:page-data-source-relations` and open
`http://127.0.0.1:3123`. This manual fixture uses synthetic in-memory records;
it does not call a backend. It exercises separate task/project property sets,
shared property creation, selection, and page-draft versus saved state. The
dedicated browser origin may retain local property-creation recovery records.
After selecting an entry, its Open button is disabled until **Save page**;
after saving, it reports the selected entry ID through the fixture callback.

This is not authenticated or full-editor acceptance. Its unscoped CSS loader
can collide across component styles and reuses Next's internal webpack; review it
on Next upgrades. Test actual task draft recovery, project conflicts, mobile,
production CSS and two-user behavior separately.
