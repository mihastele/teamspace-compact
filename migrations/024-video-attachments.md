# Migration 024: Video attachments support in private storage

## Overview

Extends the allowed MIME types for the private storage bucket (`teamspace-private`) to include video media formats:
- `video/mp4`
- `video/webm`
- `video/ogg`
- `video/quicktime`

Retains the 25 MiB file size limit and private access control on `teamspace-private`.
Advances `epoch` on `public.teamspace_store_state`.
