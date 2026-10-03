# 003 — Rich Markdown blocks and shared board embeds

2026-10-03. Additive document schema; no live database changed.

Notes retain the `content.blocks` array. Supported types now include ordered, quote, todo, code, divider, markdown and board alongside paragraph/heading/bullet. Heading blocks optionally carry integer `level` 1–6; missing values mean H1. Todo blocks optionally carry boolean `checked`; missing means false. Server validation rejects these fields on other types, unknown fields, nonempty board/divider text and existing character/block limits. Maintained TypeScript document models updated; Firestore has no generated schema types.

Deploy trusted validation and client together. Existing documents require no backfill and retain their text/type. Old clients should reload before working with new block types. Rollback must preserve the new fields/types rather than flattening or discarding content.

A board block is `{type: "board", text: ""}`. It displays the current note workspace's existing task collection, with no workspace ID/URL or independent board data. Shared task mutations still use the trusted API and existing member authorization. Removing a board block or deleting its note never deletes tasks. Exports include new block types and their fields; a board embed resolves to the exported workspace's tasks. Existing note/workspace/account deletion policies remain unchanged.

Access control on notes, workspaces, tasks, members and attachments remains member-only reads, browser writes denied, server mutations authorized. No new table, index or security rule required. Markdown HTML is not interpreted; link/image protocols validated; GFM renderer uses React elements. No executable HTML is exported as trusted content.

Verify schema/types and API fixtures on clean Firebase emulators with npm run test:rules, then npm test for shortcut, renderer and schema regressions. The new integration case persists rich blocks, checks outsider denial and confirms removing a board leaves tasks intact. Browser typing/focus/drag/save acceptance remains a separately recorded check.
