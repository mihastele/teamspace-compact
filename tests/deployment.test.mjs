import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { deploymentEnvironment, deploymentProblems, deploymentProcessEnvironment, deploymentPath, publicUrl, scopedSupabaseCompose, enableLocalMail } from '../scripts/deployment-config.mjs';
import { setupArguments } from '../scripts/setup-deployment.mjs';
import { commandArguments, dockerFailure, preflightFailure } from '../scripts/deploy.mjs';

test('staging and production receive independent aligned secrets with external credentials blank',()=>{
  const staging=parseEnv(deploymentEnvironment('staging'));
  const production=parseEnv(deploymentEnvironment('production'));
  for(const key of ['JWT_SECRET','POSTGRES_PASSWORD','DASHBOARD_PASSWORD','VAULT_ENC_KEY','REALTIME_DB_ENC_KEY'])assert.notEqual(staging[key],production[key],key);
  assert.equal(staging.PORT,'3100');assert.equal(production.PORT,'3000');
  assert.equal(staging.POSTGRES_PORT,'5432');assert.equal(production.POSTGRES_PORT,'5432');
  for(const values of [staging,production]){
    for(const key of ['SMTP_PASS','SMTP_USER','GOOGLE_CLIENT_ID','GOOGLE_SECRET','OPENAI_API_KEY'])assert.equal(values[key],'');
    assert.equal(values.ANON_KEY,values.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(values.SERVICE_ROLE_KEY,values.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(values.EMAIL_CONFIRMATION_REQUIRED,'true');
    assert.equal(values.DEV_AUTO_JOIN_WORKSPACE_ID,'');
  }
  assert.deepEqual(deploymentProblems('staging',staging,false),[]);
  assert.deepEqual(deploymentProblems('staging',staging,true),[]);
  assert.equal(staging.SMTP_HOST,'mailpit');assert.equal(production.SMTP_HOST,'');
  assert.deepEqual(deploymentProblems('production',production,false),[]);
  const issues=deploymentProblems('production',production,true).join('\n');
  assert.match(issues,/SMTP_HOST/);assert.match(issues,/placeholder/);
  assert.ok(!issues.includes(production.JWT_SECRET));
});
test('existing staging can enable captured mail without rotating keys or changing confirmation',()=>{
  const base=mkdtempSync(resolve(tmpdir(),'teamspace-mail-tests-'));
  try {
  const directory=deploymentPath('staging',base);
  mkdirSync(directory,{recursive:true});
  const source=deploymentEnvironment('staging').replace('SMTP_HOST=mailpit','SMTP_HOST=');
  writeFileSync(resolve(directory,'.env'),source);writeFileSync(resolve(directory,'compose.yaml'),'services: {}');
  enableLocalMail('staging',base);
  const values=parseEnv(readFileSync(resolve(directory,'.env'),'utf8'));
  const before=parseEnv(source);
  for(const key of Object.keys(before).filter(key=>!key.startsWith('SMTP_')))assert.equal(values[key],before[key],key);
  assert.deepEqual(deploymentProblems('staging',values,true),[]);
  enableLocalMail('staging',base);
  assert.equal(readFileSync(resolve(directory,'.env'),'utf8').split('SMTP_HOST=').length,2);
  writeFileSync(resolve(directory,'.env'),source.replace('SMTP_HOST=','SMTP_HOST=smtp.provider.test'));
  assert.throws(()=>enableLocalMail('staging',base),/external SMTP/);
  assert.throws(()=>enableLocalMail('production',base),/staging only/);
  assert.ok(deploymentProblems('production',{...values,DEPLOYMENT_ENVIRONMENT:'production'},false).some(value=>value.includes('staging only')));
  assert.throws(()=>deploymentEnvironment('staging',{webPort:'8025'}),/reserved/);
  } finally {
    assert.ok(resolve(base).startsWith(resolve(tmpdir())+sep));
    rmSync(base,{recursive:true,force:true});
  }
});
test('deployment doctor rejects key mismatches, invalid URLs, unsafe flags and invalid ports',()=>{
  const values=parseEnv(deploymentEnvironment('production',{siteUrl:'https://notes.test',apiUrl:'https://api.notes.test'}));
  const bad={...values,SUPABASE_SERVICE_ROLE_KEY:values.ANON_KEY,JWT_SECRET:'wrong',DEV_AUTO_JOIN_WORKSPACE_ID:'workspace',WEB_BIND_ADDRESS:'0.0.0.0',POSTGRES_PORT:'5433',AGENT_AUDIT_RETENTION_DAYS:'0'};
  const issues=deploymentProblems('production',bad,false).join('\n');
  for(const fragment of ['JWT_SECRET','keys must match','auto-join','loopback','POSTGRES_PORT','RETENTION'])assert.ok(issues.includes(fragment),fragment);
  for(const url of ['http://notes.test','https://name:secret@notes.test','https://notes.test/path','https://notes.test/?x=y'])assert.throws(()=>publicUrl(url,true));
  assert.throws(()=>deploymentEnvironment('production',{webPort:'8000',apiPort:'8000'}));
  assert.throws(()=>deploymentEnvironment('staging',{webPort:'0'}));
  assert.throws(()=>deploymentPath('../production'));
});
test('deployment subprocess values fence inherited production/Compose settings',()=>{
  const staging=parseEnv(deploymentEnvironment('staging'));
  const env=deploymentProcessEnvironment(staging,{PATH:'kept',COMPOSE_FILE:'foreign.yml',COMPOSE_PROJECT_NAME:'production',COMPOSE_PROFILES:'dangerous',SUPABASE_COMPOSE_ENV_FILE:'foreign.env',SUPABASE_SERVICE_ROLE_KEY:'foreign',NEXT_PUBLIC_FIREBASE_API_KEY:'foreign',SMTP_PASS:'foreign'});
  assert.equal(env.PATH,'kept');assert.equal(env.COMPOSE_FILE,undefined);assert.equal(env.COMPOSE_PROFILES,undefined);assert.equal(env.SUPABASE_COMPOSE_ENV_FILE,undefined);
  assert.equal(env.COMPOSE_PROJECT_NAME,'teamspace-staging');assert.equal(env.SMTP_PASS,'');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,staging.SERVICE_ROLE_KEY);assert.equal(env.NEXT_PUBLIC_FIREBASE_API_KEY,undefined);
});
test('setup and deployment commands reject ambiguous arguments and unsafe service lists',()=>{
  assert.deepEqual(setupArguments(['staging','--site-url','https://stage.test']),{name:'staging',options:{siteUrl:'https://stage.test'}});
  for(const args of [[],['dev'],['production','--site-url'],['production','--force','yes'],['staging','--api-port','8100','--api-port','8200']])assert.throws(()=>setupArguments(args));
  for(const args of [['production','down','--volumes'],['staging','reset'],['production','exec'],['staging','up','web']])assert.throws(()=>commandArguments(args));
  assert.deepEqual(commandArguments(['staging','up']),{name:'staging',action:'up'});
  assert.throws(()=>scopedSupabaseCompose('services: {}'),/service list changed/);
  assert.match(readFileSync(new URL('../.dockerignore',import.meta.url),'utf8'),/^deployments$/m);
  assert.match(readFileSync(new URL('../.gitignore',import.meta.url),'utf8'),/^\/deployments\/$/m);
});
test('scheduled cleanup suppresses raw child failures and shuts down on SIGTERM',async()=>{
  const child=spawn(process.execPath,['scripts/cleanup-loop.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,BACKEND_PROVIDER:'firebase',SUPABASE_SERVICE_ROLE_KEY:'do-not-log-this-marker'},stdio:['ignore','pipe','pipe']});
  let output='';let timer;
  try{
    await new Promise((done,reject)=>{
      timer=setTimeout(()=>reject(new Error('Cleanup loop did not report its bounded first attempt.')),10000);
      child.stdout.on('data',data=>{output+=data;if(output.includes('retrying in one hour'))done();});
      child.once('error',reject);
    });
    const closed=new Promise(done=>child.once('close',done));
    child.kill('SIGTERM');await closed;
    assert.ok(!output.includes('do-not-log-this-marker'));
    assert.match(output,/failed; retrying/);
  }finally{clearTimeout(timer);child.kill();}
});
test('deployment failures explain recovery without disclosing raw Docker output',()=>{
  for(const [diagnostic,expected]of [
    ['error during connect: private-token','Start Docker Desktop'],
    ['port is already allocated private-token','port is already occupied'],
    ['container private-token is unhealthy','status command'],
    ['pull access denied private-token','registry'],
    ['unexpected private-token','configuration'],
  ]){
    const message=dockerFailure('up',{status:1,stderr:diagnostic});
    assert.match(message,new RegExp(expected));
    assert.ok(!message.includes('private-token'));
  }
  assert.match(dockerFailure('config',{error:{code:'ENOENT'}}),/not found/);
  const message=preflightFailure('staging',deploymentPath('staging'),['Set SMTP_HOST.']);
  assert.ok(message.includes(deploymentPath('staging')));
  assert.match(message,/external credentials blank/);
  assert.match(message,/No services were started/);
});
