const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const loader = Module._load;
Module._load = function(id,...args){return id==='server-only'?{}:loader.call(this,id,...args);};
const firebase = require('../.test-build/server/firebase.js');
const supabase = require('../.test-build/server/supabase.js');
const { resolveRegisteredAccount } = require('../.test-build/server/registered-accounts.js');
Module._load = loader;

async function provider(name, action) {
  const names=['BACKEND_PROVIDER','NEXT_PUBLIC_BACKEND_PROVIDER','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL'];
  const saved=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  const oldFirebase=firebase.firebaseAdmin,oldSupabase=supabase.supabaseAdmin;
  try {process.env.BACKEND_PROVIDER=process.env.NEXT_PUBLIC_BACKEND_PROVIDER=name;delete process.env.SUPABASE_URL;delete process.env.NEXT_PUBLIC_SUPABASE_URL;await action();}
  finally {firebase.firebaseAdmin=oldFirebase;supabase.supabaseAdmin=oldSupabase;for(const key of names){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
}

test('Firebase registered-account resolver uses provider identity and rejects disabled/missing accounts',async()=>provider('firebase',async()=>{
  let requested;
  firebase.firebaseAdmin=()=>({auth:{getUserByEmail:async email=>{requested=email;return {uid:'canonical',displayName:'Real name',disabled:false};},getUser:async uid=>({uid,disabled:true})}});
  assert.deepEqual(await resolveRegisteredAccount('user@example.test'),{uid:'canonical',displayName:'Real name',photoURL:null});
  assert.equal(requested,'user@example.test');assert.equal(await resolveRegisteredAccount('disabled'),null);
  firebase.firebaseAdmin=()=>({auth:{getUser:async()=>{throw {code:'auth/user-not-found'};}}});
  assert.equal(await resolveRegisteredAccount('missing'),null);
  firebase.firebaseAdmin=()=>({auth:{getUser:async()=>{throw new Error('sensitive backend details');}}});
  await assert.rejects(resolveRegisteredAccount('unavailable'),error=>error.code==='account_lookup_unavailable'&&!error.message.includes('sensitive'));
}));

test('Supabase email lookup is narrow and verified account metadata cannot confer roles',async()=>provider('supabase',async()=>{
  const calls=[];
  supabase.supabaseAdmin=()=>({client:{rpc:async(name,args)=>{calls.push([name,args]);return {data:'canonical',error:null};}},auth:{admin:{getUserById:async uid=>{calls.push(uid);return {data:{user:{id:uid,user_metadata:{display_name:'User',role:'root',isRootAdmin:true}}},error:null};}}}});
  assert.deepEqual(await resolveRegisteredAccount('user@example.test'),{uid:'canonical',displayName:'User',photoURL:null});
  assert.deepEqual(calls,[['teamspace_registered_account_id',{p_email:'user@example.test'}],'canonical']);
}));

test('Supabase rejects deleted, anonymous, banned and nonexistent registered accounts',async()=>provider('supabase',async()=>{
  for(const extra of [{deleted_at:'2026-01-01'},{is_anonymous:true},{banned_until:'2999-01-01'}]){
    supabase.supabaseAdmin=()=>({auth:{admin:{getUserById:async()=>({data:{user:{id:'canonical',user_metadata:{},...extra}},error:null})}}});
    assert.equal(await resolveRegisteredAccount('canonical'),null);
  }
  supabase.supabaseAdmin=()=>({auth:{admin:{getUserById:async()=>({data:{user:null},error:{status:404}})}}});
  assert.equal(await resolveRegisteredAccount('missing'),null);
}));
