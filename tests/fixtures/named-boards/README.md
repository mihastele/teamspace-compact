# Named board browser fixture

Run `npm run test:ui:named-boards`, then open http://127.0.0.1:3118.
Stop with Ctrl+C. Reload resets its synthetic records. Close any setup dialog
before reloading, or the normal unsaved-setup warning may prevent navigation.

This mounts the real SavedViewLink, NewNamedBoard, TicketViews and TicketFilters
components under React Strict Mode. It runs only on loopback and never loads
environment files, provider credentials or a backend. The bundler is the installed
Next package's webpack; output goes to gitignored `.agentic/verification/`.
Revisit this development-only internal bundler integration when upgrading Next.
The CSS loader injects source styles with plain class names, rather than Next's
production module scoping; full-app styling still needs separate acceptance.

This is a **manual fixture**, not a headless browser test or a CI acceptance pass.
The fake query supports nested AND/OR and empty/equality/inclusion predicates;
unsupported operators and task writes fail explicitly. It has no real pagination,
authorization, CRDT, persistent recovery, backend concurrency or retention logic.
Use the PostgreSQL/API suites and authenticated acceptance for those contracts.

## Cancellation and retry checklist

1. In slot 1, choose New named board. Board name should receive focus.
   Change the name and add Project / Equals / Website.
2. Press Escape from Board name. The confirmation appears in the same modal,
   Keep editing receives focus and draft fields become disabled.
3. Press Escape again. The dialog must remain modal; focus and the unchanged
   draft return to Board name. Click Cancel, then Keep editing; focus returns to
   Cancel. No write should have happened.
4. Cancel and Discard setup. The dialog disappears, focus returns to the slot's
   New named board button and counters remain `0` writes / `1` board.
5. Reopen, enter a new name, add Project / Equals / Website again and create.
   The slot links the board, the other slot
   stays independent and Project equals Website shows only Design homepage.
6. Before opening the next setup, click Lose next save response. Create a board.
   The error should freeze its original settings and expose Retry create and link.
   Cancel now explains that a board may already exist and offers Close setup.
7. Keep editing, then Retry create and link. It must link with only one additional
   write/board. Repeat response loss, but Close setup this time: the saved board
   must remain selectable while the slot retains its earlier selection.
8. At 390x844, verify no horizontal overflow, both confirmation actions are
   reachable, Tab/Shift+Tab move between them and focus returns after dismissal.
   Reset the viewport afterward.

Remote rename and Toggle note editing retain the earlier manual shared-view
conflict/disabled-control scenarios. They simulate component inputs only.
