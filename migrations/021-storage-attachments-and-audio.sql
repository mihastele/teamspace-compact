-- Expand private attachment storage to 25 MiB and support images, audio, documents and archive attachments.
begin;
select epoch from public.teamspace_store_state where singleton for update;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('teamspace-private','teamspace-private',false,26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav',
    'application/pdf','text/plain','text/markdown','text/csv','application/json','application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ])
on conflict(id) do update set public=false,file_size_limit=26214400,
  allowed_mime_types=excluded.allowed_mime_types;

update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
