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
