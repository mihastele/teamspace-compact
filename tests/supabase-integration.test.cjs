const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(id, ...args) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
const { handleTrustedApi, handleApi } = require('../.test-build/server/api.js');
const { supabaseDocumentStore, FieldValue } = require('../.test-build/server/document-store.js');
const { guardedDocumentStore } = require('../.test-build/server/auth-policy.js');
const supabaseModule = require('../.test-build/server/supabase.js');
Module._load = originalLoad;
const Y = require('yjs');
const model = require('../.test-build/collaboration-model.js');
const container = `teamspace-sql-test-${randomBytes(6).toString('hex')}`;
let started = false, db;
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const prefix = 'workspaces/alpha';
function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', error = '';
    child.stdout.on('data', value => { out += value; }); child.stderr.on('data', value => { error += value; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(error.trim() || 'Docker test operation failed.')));
    child.stdin.end(input);
  });
}
const sql = source => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], source);
const literal = value => value === null || value === undefined ? 'null' : "'" + String(value).replace(/'/g, "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
async function rpc(name, value) {
  const expressions = {
    teamspace_store_epoch: () => '',
    teamspace_store_read: () => `${literal(value.p_epoch)}::bigint,${literal(value.p_path)},${value.p_query === null ? 'null' : json(value.p_query)}`,
    teamspace_store_commit: () => `${literal(value.p_epoch)}::bigint,${json(value.p_writes)}`,
    teamspace_store_delete_collection: () => literal(value.p_path),
  };
  assert.ok(expressions[name], 'Only the service RPC contract is allowed');
  return JSON.parse(await sql(`set role service_role; select public.${name}(${expressions[name]()});`));
}
before(async () => {
  // No published port or shared database; container and credentials belong to this test only.
  await command(['run', '-d', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`, 'postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f']);
  started = true;
  for (let attempt = 0; ; attempt++) {
    try { await sql('select 1;'); break; } catch (error) { if (attempt === 40) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    alter table storage.buckets enable row level security;
    create publication supabase_realtime;`);
  await sql(readFileSync('migrations/007-supabase-backend.sql', 'utf8'));
  db = supabaseDocumentStore(rpc);
});
after(async () => { if (started) await command(['stop', container]); });
beforeEach(async () => {
  await sql(`truncate public.teamspace_documents; update public.teamspace_store_state set epoch=0;
    truncate auth.users; insert into auth.users values('${owner}',now()),('${member}',now()),('${outsider}',null);`);
  await db.runTransaction(async tx => {
    for (const [path, data] of [
      ['security/policy', { emailConfirmationRequired: true }],
      [prefix, { name: 'Alpha', ownerId: owner }],
      [`${prefix}/members/${owner}`, { role: 'owner', displayName: 'Owner' }],
      [`${prefix}/members/${member}`, { role: 'member', displayName: 'Member' }],
      [`users/${owner}/workspaces/alpha`, {}], [`users/${member}/workspaces/alpha`, {}],
      [`${prefix}/tasks/task`, { title: 'Original', description: '', status: 'todo', assigneeId: member, dueDate: null, position: 0 }],
      [`${prefix}/notes/note`, { title: 'Original', content: { blocks: [{type:'paragraph',text:'Original'}] }, revision: 1 }],
    ]) tx.set(db.doc(path), data);
  });
});
async function api(uid, method, path, input) {
  const request = new Request(`http://test/api/${path}`, { method,
    headers: { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
  const response = await handleTrustedApi(request, path.split('?')[0].split('/'), { db, storage: {}, user: {uid,name:uid,email_verified:true} });
  return { status: response.status, data: await response.json() };
}
const value = async path => (await db.doc(path).get()).data();
test('clean migration applies RLS/default-deny RPC and private bucket limits', async () => {
  assert.equal(await sql("select bool_and(relrowsecurity) from pg_class where relname in ('teamspace_documents','teamspace_store_state');"), 't');
  assert.equal(await sql("select public::text||':'||file_size_limit from storage.buckets where id='teamspace-private';"), 'false:10485760');
  assert.equal(await sql(`set role authenticated; select set_config('request.jwt.claim.sub','${member}',false); select count(*) from public.teamspace_documents where path='${prefix}/notes/note';`).then(result => result.split('\n').at(-1)), '1');
  assert.equal(await sql(`set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false); select count(*) from public.teamspace_documents;`).then(result => result.split('\n').at(-1)), '0');
  await assert.rejects(sql("set role authenticated; select public.teamspace_store_epoch();"), /permission denied/);
  await assert.rejects(sql("set role authenticated; insert into public.teamspace_documents(path,data,version) values('workspaces/evil','{}',1);"), /permission denied/);
  await assert.rejects(sql("set role service_role; update public.teamspace_documents set data='{}';"), /permission denied/);
  await assert.rejects(sql("set role service_role; update public.teamspace_store_state set epoch=0;"), /permission denied/);
});
test('email verification gates direct RLS reads, including missing policy; false permits a member', async () => {
  await sql(`update auth.users set email_confirmed_at=null where id='${member}';`);
  const read = async () => (await sql(`set role authenticated; select set_config('request.jwt.claim.sub','${member}',false); select count(*) from public.teamspace_documents where path='${prefix}/notes/note';`)).split('\n').at(-1);
  assert.equal(await read(), '0');
  await db.runTransaction(async tx => tx.set(db.doc('security/policy'), {emailConfirmationRequired:false}));
  assert.equal(await read(), '1');
  await db.doc('security/policy').delete(); assert.equal(await read(), '0');
});
test('concurrent independent selective edits and simultaneous creation preserve final task state', async () => {
  const [a,b] = await Promise.all([api(owner,'PATCH',`${prefix}/tasks/task`,{status:'doing'}), api(member,'PATCH',`${prefix}/tasks/task`,{description:'Concurrent detail'})]);
  assert.equal(a.status,200); assert.equal(b.status,200);
  const final = await value(`${prefix}/tasks/task`); assert.equal(final.status,'doing'); assert.equal(final.description,'Concurrent detail');
  const created = await Promise.all(['A','B'].map(title => api(member,'POST',`${prefix}/tasks`,{title,status:'todo',description:'',assigneeId:null,dueDate:null,position:0})));
  assert.ok(created.every(result => result.status===201));
  assert.notEqual(created[0].data.task.id,created[1].data.task.id);
  assert.equal((await db.collection(`${prefix}/tasks`).get()).size,3);
});
test('phantom query conflicts retry and stale updates cannot resurrect deleted documents', async () => {
  let release, startedRead; const gate = new Promise(resolve => { release=resolve; }); const ready = new Promise(resolve=>{startedRead=resolve;});
  let passes=0;
  const operation = db.runTransaction(async tx => {
    const rows=await tx.get(db.collection(`${prefix}/notes`).where('parentId','==','note'));
    passes++;
    if (passes===1) { startedRead(); await gate; }
    tx.set(db.doc('tests/result'),{count:rows.size});
  });
  await ready;
  await db.runTransaction(async tx=>tx.create(db.doc(`${prefix}/notes/child`),{parentId:'note'}));
  release(); await operation;
  assert.ok(passes>=2); assert.equal((await value('tests/result')).count,1);
  await api(owner,'DELETE',`${prefix}/tasks/task`);
  const stale=await api(member,'PATCH',`${prefix}/tasks/task`,{title:'Stale'});
  assert.equal(stale.status,404); assert.equal(await value(`${prefix}/tasks/task`),undefined);
});
test('comments preserve concurrent posts, duplicate delivery, tombstones and snapshot shape', async () => {
  const path=`${prefix}/notes/note/comments`, packet={operationId:randomUUID(),body:'Hello @{'+member+'}'};
  const [a,b]=await Promise.all([api(owner,'POST',path,packet),api(member,'POST',path,{operationId:randomUUID(),body:'Reply'})]);
  assert.equal(a.status,200); assert.equal(b.status,200);
  assert.equal((await api(owner,'POST',path,packet)).data.comment.id,a.data.comment.id);
  assert.equal((await db.collection(path).get()).size,2);
  assert.equal((await api(member,'DELETE',`${path}/${a.data.comment.id}`)).status,403);
  assert.equal((await api(owner,'DELETE',`${path}/${a.data.comment.id}`)).status,200);
  const retry=await api(owner,'POST',path,packet); assert.equal(retry.data.comment.deleted,true); assert.equal(retry.data.comment.body,'');
  const snapshot=await api(member,'GET',path); assert.equal(snapshot.status,200); assert.equal(snapshot.data.comments.length,2);
  assert.equal((await api(outsider,'GET',path)).status,403);
});
test('Supabase CRDT updates merge independent concurrent changes without duplicate events', async () => {
  const init=await api(owner,'POST',`${prefix}/notes/note/collaboration`,{});
  assert.equal(init.status,200,JSON.stringify(init.data));
  const state=init.data.note.collab, generation=state.generation;
  const a=model.decodeDocument(state.state), b=model.decodeDocument(state.state);
  const make=(doc,word)=>{const vector=Y.encodeStateVector(doc); model.getTextTypes(doc)[0].insert(0,word); return Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64');};
  const first={operationId:randomUUID(),generation,update:make(a,'A')}, second={operationId:randomUUID(),generation,update:make(b,'B')};
  const results=await Promise.all([api(owner,'POST',`${prefix}/notes/note/updates`,first),api(member,'POST',`${prefix}/notes/note/updates`,second)]);
  assert.ok(results.every(result=>result.status===200));
  const retry=await api(owner,'POST',`${prefix}/notes/note/updates`,first); assert.equal(retry.status,200);
  const text=(await value(`${prefix}/notes/note`)).content.blocks[0].text;
  assert.ok(text.includes('A')&&text.includes('B')); assert.equal(text.length,'ABOriginal'.length);
  a.destroy();b.destroy();
});
test('trusted Auth boundary rejects unconfirmed accounts and policy mismatch without leaking secrets', async () => {
  const names=['BACKEND_PROVIDER','NEXT_PUBLIC_BACKEND_PROVIDER','EMAIL_CONFIRMATION_REQUIRED','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_STORAGE_BUCKET'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]])); const original=supabaseModule.supabaseAdmin;
  try {
    Object.assign(process.env,{BACKEND_PROVIDER:'supabase',NEXT_PUBLIC_BACKEND_PROVIDER:'supabase',EMAIL_CONFIRMATION_REQUIRED:'true',SUPABASE_URL:'http://test',NEXT_PUBLIC_SUPABASE_URL:'http://test',SUPABASE_SERVICE_ROLE_KEY:'test-only',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-only',SUPABASE_STORAGE_BUCKET:'teamspace-private'});
    let confirmed=false;
    supabaseModule.supabaseAdmin=()=>({db,auth:{getUser:async()=>({data:{user:{id:member,email:'test@example.test',email_confirmed_at:confirmed?'2026-01-01':null,user_metadata:{}}},error:null})}});
    const request=()=>new Request('http://test/api/workspaces',{headers:{Authorization:'Bearer test-token'}});
    assert.equal((await handleApi(request(),['workspaces'])).status,403);
    confirmed=true;assert.equal((await handleApi(request(),['workspaces'])).status,200);
    process.env.EMAIL_CONFIRMATION_REQUIRED='false';assert.equal((await handleApi(request(),['workspaces'])).status,503);
    await db.runTransaction(async tx=>tx.set(db.doc('security/policy'),{emailConfirmationRequired:false}));
    confirmed=false;assert.equal((await handleApi(request(),['workspaces'])).status,200);
  } finally {supabaseModule.supabaseAdmin=original;for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
test('nested merges and rapid sequential writes use acknowledged server versions', async () => {
  await db.runTransaction(async tx=>tx.set(db.doc('tests/nested'),{map:{a:1,b:2},count:1}));
  await db.runTransaction(async tx=>tx.set(db.doc('tests/nested'),{map:{a:3},count:FieldValue.increment(1)},{merge:true}));
  assert.deepEqual(await value('tests/nested'),{map:{a:3,b:2},count:2});
  for(let i=0;i<4;i++) await api(member,'PATCH',`${prefix}/tasks/task`,{description:String(i)});
  assert.equal((await value(`${prefix}/tasks/task`)).description,'3');
});
test('expiry cleanup preserves named history and permanent receipts and advances the epoch', async () => {
  await db.runTransaction(async tx => {
    for(const [path,data] of [
      [`${prefix}/notes/note/historyVersions/automatic`,{kind:'checkpoint',expiresAt:{$ts:1}}],
      [`${prefix}/notes/note/historyVersions/named`,{kind:'named',expiresAt:{$ts:1}}],
      [`${prefix}/notes/note/collaborationReceipts/permanent`,{expiresAt:{$ts:1}}],
      [`${prefix}/notes/note/presence/old`,{expiresAt:{$ts:1}}],
      [`${prefix}/attachments/pending`,{status:'pending',expiresAt:{$ts:1}}],
      [`${prefix}/attachments/ready`,{status:'ready',expiresAt:{$ts:1}}],
    ])tx.set(db.doc(path),data);
  });
  const initial=await rpc('teamspace_store_epoch',{});
  const result=JSON.parse(await sql('set role service_role; select public.teamspace_store_prune_expired();'));
  assert.equal(result.removed,3);
  assert.equal(BigInt((await rpc('teamspace_store_epoch',{})).epoch),BigInt(initial.epoch)+1n);
  assert.equal(await value(`${prefix}/notes/note/historyVersions/automatic`),undefined);
  assert.ok(await value(`${prefix}/notes/note/historyVersions/named`));
  assert.ok(await value(`${prefix}/notes/note/collaborationReceipts/permanent`));
  assert.ok(await value(`${prefix}/attachments/ready`));
});
test('history restore preserves tasks and conversations and rejects stale replay payloads', async () => {
  const named=await api(owner,'POST',`${prefix}/notes/note/history`,{expectedRevision:1,name:'Permanent baseline'});
  assert.equal(named.status,200,JSON.stringify(named.data));
  const posted=await api(member,'POST',`${prefix}/notes/note/comments`,{operationId:randomUUID(),body:'Keep this discussion'});
  assert.equal(posted.status,200);
  const change=await api(owner,'PATCH',`${prefix}/notes/note`,{expectedRevision:1,title:'New title',content:{blocks:[{type:'paragraph',text:'New body'}]}});
  assert.equal(change.status,200);
  const packet={versionId:'r1',expectedRevision:2,operationId:randomUUID()};
  const restored=await api(owner,'POST',`${prefix}/notes/note/restore`,packet);
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.equal(restored.data.note.title,'Original');
  assert.equal(restored.data.note.content.blocks[0].text,'Original');
  const replay=await api(owner,'POST',`${prefix}/notes/note/restore`,packet);
  assert.equal(replay.status,200);
  assert.equal(replay.data.note.revision,restored.data.note.revision);
  assert.equal((await db.collection(`${prefix}/notes/note/comments`).get()).size,1);
  assert.equal((await db.collection(`${prefix}/tasks`).get()).size,1);
});
test('concurrent reciprocal page moves cannot form a cycle', async () => {
  const created=await Promise.all(['A','B'].map(title=>api(owner,'POST',`${prefix}/notes`,{title,content:{blocks:[]},parentId:null})));
  assert.ok(created.every(result=>result.status===201));
  const [a,b]=created.map(result=>result.data.note);
  const moves=await Promise.all([
    api(owner,'PATCH',`${prefix}/notes/${a.id}`,{expectedRevision:1,title:a.title,content:a.content,parentId:b.id}),
    api(member,'PATCH',`${prefix}/notes/${b.id}`,{expectedRevision:1,title:b.title,content:b.content,parentId:a.id}),
  ]);
  assert.equal(moves.filter(result=>result.status===200).length,1);
  const finalA=await value(`${prefix}/notes/${a.id}`),finalB=await value(`${prefix}/notes/${b.id}`);
  assert.ok(!(finalA.parentId===b.id && finalB.parentId===a.id));
});
test('tightening the email policy aborts a concurrent unconfirmed durable mutation', async () => {
  await db.runTransaction(async tx=>tx.set(db.doc('security/policy'),{emailConfirmationRequired:false}));
  const guarded=guardedDocumentStore(db,false,false);
  let release,read;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{read=resolve;});
  const operation=guarded.runTransaction(async tx=>{await tx.get(db.doc(`${prefix}/tasks/task`));read();await gate;tx.update(db.doc(`${prefix}/tasks/task`),{title:'Must not commit'});});
  await ready;
  await db.runTransaction(async tx=>tx.set(db.doc('security/policy'),{emailConfirmationRequired:true}));
  release();await assert.rejects(operation,error=>error.code==='policy_mismatch');
  assert.equal((await value(`${prefix}/tasks/task`)).title,'Original');
});
