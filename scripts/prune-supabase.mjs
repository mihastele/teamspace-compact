// Schedule hourly with server environment loaded. Never run against the other provider.
import { createClient } from '@supabase/supabase-js';
if (process.env.BACKEND_PROVIDER !== 'supabase') throw new Error('Supabase must be the selected deployment backend.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET;
if (!url || !key || !bucket || url !== process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Matching Supabase URL and private storage settings are required.');
const client = createClient(process.env.SUPABASE_INTERNAL_URL || url, key, {auth:{persistSession:false,autoRefreshToken:false}});
const {error} = await client.rpc('teamspace_store_prune_expired');
if (error) throw new Error('Expired metadata could not be pruned. Check migration and server permissions.');
const {data: result,error: readError} = await client.rpc('teamspace_store_read', {
  p_epoch:null,p_path:'workspaces',p_query:{path:'workspaces',filters:[],limit:null},
});
if (readError) throw new Error('Workspace metadata could not be read for staging cleanup.');
const files = client.storage.from(bucket);
const cutoff = Date.now()-24*3600000;
for (const row of result.rows) {
  const workspace = row.path.split('/')[1];
  if (!/^[a-zA-Z0-9_-]+$/.test(workspace)) throw new Error('Invalid workspace path during staging cleanup.');
  // Pagination is completed before removal, preventing offset shifts from skipping files.
  const expired=[];
  for(let offset=0;;offset+=100) {
    const {data,error:listError}=await files.list(`staging/${workspace}`,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
    if(listError) throw new Error('Staging files could not be listed. No document contents were logged.');
    for(const object of data) {
      const created=Date.parse(object.created_at);
      const updated=Date.parse(object.updated_at);
      if(object.id && /^[a-zA-Z0-9_-]+$/.test(object.name) && Number.isFinite(created) && Number.isFinite(updated) && Math.max(created,updated)<cutoff)
        expired.push(`staging/${workspace}/${object.name}`);
    }
    if(data.length<100)break;
  }
  for(let index=0;index<expired.length;index+=100) {
    const {error:removeError}=await files.remove(expired.slice(index,index+100));
    if(removeError) throw new Error('Staging cleanup failed. Retry the job; document attachments were not targeted.');
  }
}
console.log('Supabase expiry and abandoned staging cleanup completed.');
