# Recovery archive browser acceptance

Run `npm run test:ui:recovery-archives` and open http://127.0.0.1:3119.
Stop with Ctrl+C. This dedicated loopback origin uses the real archive component,
IndexedDB store, Yjs decoder and Markdown exporter under React Strict Mode.
It does not load environment files, contact a backend or edit live workspaces.

Click **Seed archives** once. This appends 25 page archives, one archive in each
source/account/workspace scope and an active page journal. Repeated seeding
appends more archives. No reset/delete action is provided. All records are
synthetic and persist on this origin. The pending packet is a storage fixture,
not a replayable collaboration update; this harness never starts a controller.

Manual checklist:

1. Open Local recovery archives. Close receives focus; 20 rows and Load older
   archives appear. Tab moves to Refresh; Shift+Tab returns to Close. Escape
   removes the dialog and restores its trigger. Reopening works.
2. Download the newest Markdown. Inspect the actual file: current fixture title,
   timestamp and `Archived page content 25: café 🐈`. Load older archives exposes
   all 25 rows and removes the pagination button.
3. Leave a fresh first page open. In another tab on this same origin, click Add
   newer archive. Load older in the first tab still completes the original 25
   rows. Refresh starts a new first page; the newest download contains
   `NEW ARCHIVE FROM ANOTHER TAB`.
4. Close and click Add corrupt archive. Reopen and download the first row. An
   error explains that the data is retained. Download the second row successfully.
   The other archives remain listed.
5. Switch Fixture scope to source, account and workspace in turn. Each dialog
   lists one archive; its downloaded text is `Isolated <scope> content`. The page
   archives never appear in those lists.
6. On the tab that seeded, click Verify active journal. It must report PASS
   after all browsing/downloads/corrupt reads. This compares the real active
   record to the exact baseline saved in that tab's sessionStorage.
7. At 390x844, check the dialog has equal client/scroll widths, controls remain
   reachable by scrolling, and Escape restores focus. Reset viewport afterward.

This is a manual component fixture, not an automated DOM suite or full-app
acceptance. It does not cover authentication, linked-source panel placement,
restore/controller/IME integration, or deterministic closing/navigation while
storage reads are delayed. Those remain separate acceptance checks. CSS source
injection reuses the named-board fixture loader and does not emulate Next CSS
module scoping. The server reuses Next's installed internal webpack hook; review
this development-only dependency on future Next upgrades. Restart to rebuild
after source edits.
