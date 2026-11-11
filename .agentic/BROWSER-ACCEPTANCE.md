# Browser acceptance evidence

## 2026-10-17 — Local table, calendar and mobile navigation

Environment: Next.js development preview at http://localhost:3000, application
based on `fbb6648` with the mobile navigation CSS fix in this iteration. Used the
in-app browser through the supported browser tool. The page explicitly showed
local preview; no authenticated backend or shared workspace was tested.

| Check | Result |
| --- | --- |
| Table keyboard sorting | Enter on Task cycles ascending, descending and board order; live status text updates and focus stays on the sort button. |
| Status filter | Done reduces four existing rows to the one completed task; Reset table restores all four. |
| Column visibility | Assignee checkbox hides its header/cells and reduces the column count from four to three; Reset restores it. Task visibility is disabled in the picker. |
| Task dialog | Opening Shape the project brief from Table focuses Task name; Escape closes and restores focus to that row's task button. No existing task was edited. |
| Calendar keyboard | Right moves October 17 to October 18; Page Down moves to November 18 with selected-day focus following. |
| Calendar creation | Add task for this day prefills 2026-11-18. Saved `Acceptance 2026-10-17: calendar to table`; calendar count becomes one for that day. |
| Shared local views/persistence | The created task appears in Table with due date 2026-11-18; reloading and reopening Table retains it. The fixture remains in local preview for inspection. |
| Mobile navigation | Before fix, document scroll width was 479px at a 390px viewport, with Members extending beyond the viewport. Wrapping the mobile flex navigation keeps all five destinations within the page. |
| Responsive widths | After fix, document scroll width equals document client width at 320px (305), 390px (375), 760px (745), and 1280px (1265). The 15px difference is the vertical scrollbar. |
| Contained table scrolling | At 320px, the focusable table region has client width 239px and scroll width 610px. Arrow Right moves its scrollLeft to 31px without expanding the page. |

Screenshots are local, gitignored evidence:

- `.agentic/verification/mobile-navigation-2026-10-17.png` (390px, full page).
- `.agentic/verification/mobile-nav-preview-2026-10-17.png` (390px, navigation/header crop).
- `.agentic/verification/task-table-2026-10-17.png` (1280px, full page).

The browser's initial connection refusal preceded server startup. Navigation and
focus-emulation calls then timed out during initial compilation; once the preview
returned HTTP 200, the same tab became readable and the checks above completed.
A label selector also matched a hidden column checkbox; using the observed
Status combobox resolved the test selector. These were tooling/startup issues,
not application acceptance failures. No browser security bypass was used.

Still open: authenticated two-user behavior, editor typing/IME/Undo and linked
content, archive dialog/IndexedDB recovery/downloads, history restores,
conversations, custom-field editing/export, mobile task dialogs and live
Auth/Storage acceptance. This manual session does not add a persisted automated
browser suite or close R1/R2 as a whole. Prior browser-policy failures remain
historical evidence, but no longer establish that all local UI checks are blocked.


## 2026-10-18 — Save-based task pages and templates

Tested the Next development build in browser-local preview on 127.0.0.1:3010,
with the existing IAB browser automation. No configured backend/account was used.

- Created a task with a slash-inserted H2 and a second paragraph, saved/reopened it,
  and verified actual heading/body persistence. A task created from a saved shared
  template retained its own copied body/title when the template was later edited.
- Created and edited a named task template, applied it to a new draft with explicit
  replacement review, and archived/restored it through the task-page controls.
- Created a multi-select field with Bug/UI options from inside a task page; checked
  both, saved, reloaded and verified both selections and block formatting remained.
- Changed task status in a second tab while the first held an unsaved body edit.
  Save rejected the stale revision and retained the draft. The latest-version review
  displayed the other tab's In progress state and saved body. Explicit rebase plus
  Save preserved that status and the user's body; reopening confirmed both.
- Opened the same task in two tabs: the second Save was disabled while the first
  owned its draft. Closing the first transferred ownership and refreshed the second
  editor's saved content/status. Task-name focus followed ownership acquisition.
- Recovered an unsaved task draft after a development runtime-error reload. The
  original body text survived and completed the conflict-review/save flow afterward.
- Verified the 390x844 viewport: document scroll/client widths matched at 375px and
  dialog scroll/client widths matched (341px after the fixed-action-bar change).
  Task controls fit without horizontal overflow. Desktop visual review confirmed
  the rich body and persistent Save/Cancel actions. Viewport override was reset.
- Screenshot: `.agentic/verification/task-pages-desktop.jpg` (gitignored). Test-only
  local fixtures remain: Task blocks acceptance, Task created from template
  acceptance, Bug report acceptance template and Acceptance labels field. Existing
  preview tasks were not edited/deleted. Development server was stopped afterward.

Verification caught/fixed empty optional-template values, draft-lock initialization
and handover around Strict Mode/remounts, and passing a Markdown export object to a
string renderer during conflict review. Final browser checks used the corrected
code. Early refused navigation/compilation timeout and stale selectors were resolved
using normal documented browser actions; no browser security bypass occurred.

Open: authenticated two-user/template Realtime acceptance on Firebase/Supabase,
provider outage/response-loss/storage-quota/IME UI scenarios and a persisted automated
React/browser suite. Actual database revision/replay/access/migration behavior has
separate integration tests; local UI checks are not deployed acceptance.

## 2026-10-18 — Task duplication and repeatable preview

- Started using `npm run dev:preview` on http://127.0.0.1:3107. The config API
  returned provider=firebase, configured=false. No Docker/backend was started or
  configured data modified. The script never edits environment files.
- Opened seeded Shape the project brief, chose Task actions / Duplicate task,
  and verified the copy title, body, assignee and Design review custom value.
  Closing offered to retain the draft; after accepting and reloading, Add task
  recovered the copy before its first Save.
- Before finishing that draft, attempting a second duplicate preserved the source
  and displayed the existing-new-draft message. The retained copy was unchanged.
- Saved the recovered copy as Duplicate acceptance copy with Independent copied
  body. Board showed four tasks, independent copied text and the original source
  title/body unchanged. This synthetic local task remains for review.
- Unsaved source-title edits disabled Duplicate task; restored the original title
  without saving. Escape dismissed the actions menu and restored its trigger focus.
- At 390x844, dialog clientWidth=scrollWidth=341px; actions menu and fixed Save/Cancel
  footer fit the viewport. Screenshots: `.agentic/verification/task-copy-desktop.png`
  and `task-copy-mobile.png` (gitignored). Reset the viewport afterward.
- Stopped the owned npm/Next preview with Ctrl+C; no listening socket remained on
  3107. The unrelated port-3000 application was untouched.

Open: persisted React/browser automation, authenticated Firebase/Supabase duplicate
creation with unavailable/archived scoped references and two-user acceptance.
Automated tests cover independent field/block copying, metadata exclusion, limits,
legacy literal text and preview argument/environment isolation. Existing trusted
create validation/retry tests remain separate from browser-local evidence.

# Independent databases — 2026-10-18 acceptance scope

Migration 016 implements PostgreSQL-only collections alongside Tasks/Projects.
No authenticated browser fixture/live stack was exercised for this increment;
unit/real PostgreSQL/API/build evidence does not establish DOM acceptance.

Pending browser checks: create Clients/Documents databases; add scalar/select
and cross-database relation fields; rich entry Save/reopen; select two related
entries and follow outgoing/incoming links; rename a target/property; archive,
retain/clear links, reject new archived links and restore; recover a new-record
draft after reload; competing-tab Web Lock handover; stale schema/body saves,
outage/response-loss retry, quota/read failure and IME recovery. Verify Load more,
loaded-title search, the export truncation flag, 30-second refresh versus expanded
pages, downloads, Escape/focus restoration, 390px overflow and authenticated
two-user propagation/revocation. No screenshot or manual-acceptance claim.


## 2026-10-19 — Named board React component fixture

Tested actual SavedViewLink/NewNamedBoard/TicketViews/TicketFilters components
bundled by the installed Next webpack/TypeScript tools in a gitignored fixture
on 127.0.0.1:3118. Its in-memory API is synthetic, with two tasks, two Projects
and relation/number fields; this is not authenticated API/CRDT/two-user acceptance.

- PASS: initial name focus; create Website work with Project equals Website,
  automatic linking, one matching task and unchanged second block.
- PASS: second board, synthetic accepted save with lost response, frozen settings
  and Retry create and link; write/board counters prove retry made no duplicate.
- PASS: embedded Filters and presentation exposes property/Project controls,
  sorting/grouping/visible fields; remote update retains a dirty name and exposes
  a review warning. Pristine second board follows the newer shared name.
- PASS: disabled note editing disables new/link/save/filter controls. Stale shared
  Save rejects; Save as new view creates and links an independent definition.
- PASS: at 390x844 the new-board dialog clientWidth/scrollWidth are both 339px;
  document width 375px stays within 390px. Initial name focus remains correct.
- UNVERIFIED: Escape/confirmation/focus restoration. Browser CDP commands stalled
  when the native discard confirmation opened; subsequent dialog/cleanup/viewport
  reset calls timed out and the tool reset. No successful cancellation or final
  viewport-reset claim. The temporary browser tab is agent-created; fixture server
  was stopped through its owned process session. No live data was involved.
- No screenshot file was saved. Fixture CSS was loaded from the real components;
  whole-app styling, note CRDT/history integration, IME and authenticated two-user
  acceptance remain open, as does a persisted automated DOM suite. UI checks
  preceded the final save-lifetime/ref guard refinement; final production build
  and typecheck cover that refinement, not a new browser rerun.

## 2026-10-19 — Named board cancellation and maintained fixture

R14 (renumbered from the duplicate R13 label; deployment setup remains R13).
Added the maintained `tests/fixtures/named-boards/` harness, launched through
`npm run test:ui:named-boards` at 127.0.0.1:3118. Real components run under Strict
Mode with a synthetic in-memory API. It is a manual fixture, not an automated
browser suite. CSS source injection does not reproduce Next's module scoping.

- PASS: initial Board name focus, Escape opens an in-dialog confirmation with
  Keep editing focused; draft fields are disabled during review.
- PASS: second Escape keeps the native dialog open/modal and returns to the
  original Board name input, preserving its name and Project equals Website
  filter. Subsequent creation displays only Design homepage; slot 2 is unchanged.
- PASS: Cancel / Keep editing restores Cancel focus; Cancel / Discard setup
  removes the dialog and focuses its own New named board trigger. No writes or
  boards are added by discard (`0` writes / `1` initial board).
- PASS: accepted save with synthetic lost response freezes the original request;
  cancellation warns that a board may already exist. Keep editing then Retry
  create and link adds exactly one board/write. Closing another uncertain setup
  retains its saved board in the picker and leaves the slot's selection unchanged.
- PASS: at 390x844, dialog clientWidth=scrollWidth=324px, page width=375px;
  both confirmation actions end at y786 within the viewport. Tab moves from Keep
  editing to Discard setup; Shift+Tab returns. Viewport reset succeeded afterward.
  Screenshot: `.agentic/verification/board-cancel-mobile.png` (gitignored).
- Initial testing exposed repeated native Escape closing the dialog despite the
  cancel handler while CSS kept the closed element visible. Intercepting Escape
  at keydown and hiding closed dialogs fixed it; the final maintained fixture
  verifies the corrected open/modal state and restored input focus.
- A reload while setup was open retained the earlier page through its unsaved
  warning; discarded that synthetic draft before reloading and rerunning. A
  request to press Tab on the inert body failed; used the enabled dialog actions
  to finish successfully. No browser setting/security workaround was used.

The final fixture includes explicit errors for unsupported synthetic filters/task
mutations. It does not establish backend authorization, CRDT/history/IME behavior,
durable setup recovery, whole-app styling or authenticated two-user acceptance.
The complete automated unit suite, build/typecheck/lint and HTTP smoke remain
separate evidence. No live accounts, database or deployed application changed.

## 2026-10-20 — R1 recovery archive component acceptance

Maintained fixture: `npm run test:ui:recovery-archives`, loopback:3119. Real
RecoveryArchives, IndexedDB, Yjs decode and Markdown export under React Strict
Mode, with synthetic device-local records. No backend or live account involved.

- PASS: initial Close focus; Tab to Refresh and Shift+Tab back; Escape removes
  dialog and restores its Local recovery archives trigger; close/reopen works.
- PASS: first page has 20 archives; Load older yields 25 and removes the button.
  Actual downloaded Markdown contains archive 25's `café 🐈` text and current
  fixture title/timestamp. Downloaded files were read from disk for verification.
- PASS: second tab adds a newer archive while the original first page is open.
  Continuation still yields the original 25; Refresh then downloads the new
  `NEW ARCHIVE FROM ANOTHER TAB` content.
- PASS: newest corrupt checkpoint reports Invalid base64 collaboration payload
  and keeps data/retry guidance. Next valid archive still downloads successfully.
- PASS: page/source/account/workspace selections remain separate. The latter
  three each list one archive; actual files contain the corresponding isolated
  scope text. Active page journal compares byte-for-byte equal to its saved JSON
  baseline after all paging, downloads and corrupt reads.
- PASS: 390x844 dialog clientWidth=scrollWidth=339px, page width=390px. Close,
  scrolling content and download controls remain usable. Screenshot at
  `.agentic/verification/recovery-archives-mobile.jpg` (gitignored). Browser
  viewport reset, both temporary tabs closed and owned fixture server stopped.
- Tooling correction: viewport first applied to the other open fixture tab;
  measurements still showed 1280px. Closed that tab and reapplied; final 390px
  measurements/screenshot above are from the intended tab. No app change needed.

All 229 unit/model/controller/provider/setup cases and warning-free lint pass.
Production code/schema is unchanged; prior build/backend evidence remains
historical. This manual fixture is not an automated DOM suite. It uses CSS source
injection, so full-app CSS module integration is not established. Source scope
checks do not establish linked-source recovery-panel placement, controller/restore
or IME integration. Full-app authenticated recovery and deliberately delayed-read
close/navigation checks remain open; R1/R2 are not closed as a whole.


## 2026-10-21 — Independent database table sorting: acceptance pending

Typed loaded-row sorting has unit coverage, but no new browser interaction
acceptance is claimed for this increment. Verify on an authenticated PostgreSQL
workspace: keyboard header activation, ascending/descending/default cycling and
aria-sort, Reset sort, renamed option/person/relation labels, search/archive
filters, Load more and Refresh retaining order, database switching resetting it,
and narrow-screen table scrolling. Confirm the loaded-entry count and more
available indicator do not imply sorting the entire server collection. Existing
R12 two-user/access/recovery/mobile acceptance remains open.


## 2026-10-21 — Searchable database relation picker component

Real DatabaseRelationPicker rendered under React Strict Mode with synthetic
60-entry targets, retained archived/unavailable selections and read-state
controls. Repeat with `npm run test:ui:database-relations`; checklist in
`tests/fixtures/database-relations/README.md`.

- Case-insensitive Unicode search retains selected entries outside the query.
  Selecting a result updates exact IDs; removing unavailable/archived entries
  clears their IDs, and unselected archived entries are disabled.
- At 50 selections a new target is disabled; removing one enables its replacement
  and the count returns to 50. Loading/failure leave selections unchanged; Retry
  restores names while keeping the query/IDs.
- Archived target database blocks new links while retaining removal controls.
  Disabled editing blocks checkboxes and Clear links. Search remains local.
- Tab from search focuses Client 1; Space removes it. Clear links clears filtered
  selections; an unmatched query shows No matching entries and disabled Clear.
- At 390x844: page width 390px; picker client/scroll widths 358px. Screenshot:
  `.agentic/verification/relation-picker-mobile.jpg` (gitignored). Viewport reset,
  temporary tab closed and owned fixture server stopped; no port-3120 listener.

This verifies the component only. The fixture uses CSS source injection, not
production module scoping, and does not exercise parent target-fetch fencing,
entry locks/draft saves, real providers or two-user acceptance. Those and the
persisted automated DOM suite remain open. No live workspace data changed.
