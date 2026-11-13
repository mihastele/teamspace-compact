# Storage Attachments and Audio (021)

Expands the private Supabase Storage bucket (`teamspace-private`) to support files up to 25 MiB (26,214,400 bytes) and broadens allowed MIME types for:
- Images: JPEG, PNG, WebP, GIF
- Audio: WebM, Ogg, MP4/M4A, MPEG/MP3, WAV
- Documents & Archives: PDF, Plain text, Markdown, CSV, JSON, ZIP, DOCX, XLSX, PPTX

## Rollout and security

1. Direct client reads and writes remain denied by Supabase Storage RLS. Uploads require signed create-only URLs issued by the trusted API.
2. Server validates magic bytes and MIME formats; image EXIF/location metadata is stripped on upload.
3. Audio recordings and attachments are scoped to workspace and parent entity permissions.
