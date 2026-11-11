# 021 - openNotion Unified Schema

## Summary

Introduces native PostgreSQL tables for openNotion:
- `public.opennotion_blocks`: Unified blocks table storing Pages, Databases, and Content Blocks with hierarchical containment (`parent_id`), fractional indexing (`position`), and JSON properties.
- `public.opennotion_database_properties`: Strongly-typed schema definition for databases (`title`, `status`, `select`, `date`, `person`, `relation`, etc.).
- `public.opennotion_database_views`: Saved multi-layout views (`table`, `board`, `list`, `calendar`) with sort, filter, and column visibility.
- `public.opennotion_block_relations`: Indexed bidirectional relationships and backlinks between pages and entries.

## Access Control & RLS

Row-Level Security (RLS) is enabled on all tables:
- `opennotion_blocks_member_read`
- `opennotion_db_props_member_read`
- `opennotion_db_views_member_read`
- `opennotion_relations_member_read`

All policies enforce workspace membership via the `teamspace_can_read` security definer function. Direct writes from anonymous/authenticated roles are denied; mutations pass through trusted, authenticated services.
