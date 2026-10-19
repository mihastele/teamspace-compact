# Note boards and connected work

Status: user chose named views over shared tickets and existing Project/property filters. First note-board increment implemented; authenticated deployment acceptance remains open.

Cancellation/focus follow-up: in-dialog Keep editing / Discard setup (or Close
setup after an attempted save), repeated Escape preserving the modal and draft,
focus restoration and 390px layout verified on October 19. Maintained manual
fixture: `npm run test:ui:named-boards`; checklist in
`tests/fixtures/named-boards/README.md`. Automated DOM and authenticated whole-app
acceptance remain open.

## Existing implementation

- Notes accept multiple `/kanban` blocks. Each can keep basic local settings or link to a workspace-shared saved view.
- Basic settings cover name, search, status, assignee, deadlines and sorting.
- PostgreSQL saved views already support typed custom-property filters, nested AND/OR, Project relations, sorts, visible fields and board/table/list layouts.
- Ticket relation properties currently reference one Project. Independent database relation properties reference multiple entries in a specified database and expose incoming links.
- Independent databases do not yet have board layouts or note embeds. No ticket-to-ticket or ticket-to-database-entry relation exists.

Source entry points: `src/app/components/BlockEditor.tsx`, `src/app/page.tsx`, `src/app/components/TicketViews.tsx`, `src/app/components/TicketFilters.tsx`, `src/lib/linked-content.ts`, `src/lib/ticket-query.ts`, `src/lib/databases.ts`.

## Decisions requested on 2026-10-19

1. Named boards as saved views of shared tickets (recommended) versus independent boards that own separate ticket collections. The former reuses existing identities and services; the latter needs an explicit ownership/move/migration contract.
2. First relation increment: expose current Project relation filtering more directly (recommended), add ticket-to-ticket links, or link tickets to independent database entries. Filtering by a related record's own properties is a further query capability, distinct from filtering by the selected relation ID.

User explicitly selected both recommended options. Implement the first increment using existing saved-view storage and ticket/Project filters; new relation targets and separate ticket ownership remain future decisions.

## Proposed implementation order

1. **Make board blocks useful at insertion.** Choose an existing named view or create a new one from the note. Give each block an explicit name/source and direct access to property/relation filters. Clearly identify shared view edits; preserve legacy blocks and basic provider support.
2. **Connected ticket properties.** Implement the selected relation target with server authorization, stable identities, incoming-link behavior, missing/archived target rules and filtering. Any new schema requires a numbered migration, maintained types, clean/populated upgrade tests and access-control/export/deletion verification.
3. **Independent database layouts.** Add saved board/table/list configurations and embeds for existing database entries; agree grouping and persistence contracts before building. Keep entry pages and relation targets authoritative across layouts.
4. **Derived summaries.** Propose bounded rollups such as linked-ticket count, completed count and summed estimate after relation semantics are settled. Formula execution and mutation buttons need their own defined contracts; they are not implicitly authorized arbitrary code or background automations.

## Acceptance for the first increment

- Two boards in one note can display different named views and filters; two notes can reuse a named view without copying tickets.
- Existing blocks, note collaboration, history and Markdown references round-trip without losing settings.
- Removing a block leaves tickets and shared views intact; unavailable references fail visibly.
- Property/Project filters use existing server-validated query semantics, including AND/OR and explicit timezone.
- Creation retries cannot duplicate saved views; stale edits retain review/conflict behavior.
- Keyboard focus, mobile layout, duplicate blocks, refresh and two-user updates are checked; unverified browser/deployed cases stay explicitly open.
- Run unit regressions, lint, build and sequential typecheck; run backend/migration suites when those layers change. Update README/SPEC and append continuity evidence before completion.

## Product references

- Linked views share records while keeping view settings: https://www.notion.com/help/guides/using-linked-databases
- Relations and rollups connect records and aggregate related properties: https://www.notion.com/help/relations-and-rollups

These references inform the proposed experience; they do not imply feature parity or completed implementation.
