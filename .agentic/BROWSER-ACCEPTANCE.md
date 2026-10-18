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
