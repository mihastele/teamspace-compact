import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createSupabaseEnvironment } from './supabase-env.mjs';
import { SUPABASE_COMMIT } from './prepare-supabase.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function deploymentName(value) {
  if(!['staging','production'].includes(value))throw new Error('Choose staging or production.');
  return value;
}
export function deploymentPath(name, base=root) { return resolve(base,'deployments',deploymentName(name)); }
export function publicUrl(value, production=false) {
  let url;try{url=new URL(value);}catch{throw new Error('Use an absolute website/API URL.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol)||((production||!local)&&url.protocol!=='https:'))throw new Error('Public URLs must be HTTPS origins; staging permits HTTP on loopback only.');
  return url.origin;
}
function port(value) {if(!/^\d+$/.test(String(value))||Number(value)<1024||Number(value)>65535)throw new Error('Host ports must be integers from 1024 to 65535.');return String(Number(value));}
export function deploymentEnvironment(name, options={}, template=readFileSync(resolve(root,'.env.supabase.example'),'utf8')) {
  deploymentName(name);
  const production=name==='production';
  const webPort=port(options.webPort??(production?3000:3100));
  const apiPort=port(options.apiPort??(production?8000:8100));
  if(webPort===apiPort)throw new Error('Website and API host ports must differ.');
  const site=publicUrl(options.siteUrl??(production?'https://teamspace.example.com':`http://localhost:${webPort}`),production);
  const api=publicUrl(options.apiUrl??(production?'https://api.teamspace.example.com':`http://localhost:${apiPort}`),production);
  if(site===api)throw new Error('Website and Supabase API require separate origins.');
  const values={
    COMPOSE_PROJECT_NAME:`teamspace-${name}`, DEPLOYMENT_ENVIRONMENT:name,RELEASE_TAG:'local',
    PORT:webPort,API_GW_HTTP_PORT:apiPort,WEB_BIND_ADDRESS:'127.0.0.1',
    POSTGRES_PORT:'5432',POOLER_PROXY_PORT_TRANSACTION:'6543',
    SITE_URL:site,APP_URL:site,ADDITIONAL_REDIRECT_URLS:`${site}/`,
    NEXT_PUBLIC_SUPABASE_URL:api,SUPABASE_URL:api,SUPABASE_PUBLIC_URL:api,API_EXTERNAL_URL:`${api}/auth/v1`,
    POOLER_TENANT_ID:`teamspace-${name}`,STORAGE_TENANT_ID:`teamspace-${name}`,
    STUDIO_DEFAULT_PROJECT:`Teamspace ${name}`,ROOT_ADMIN_UIDS:'',DEV_AUTO_JOIN_WORKSPACE_ID:'',
    EMAIL_CONFIRMATION_REQUIRED:'true',GOOGLE_AUTH_ENABLED:'false',
    SMTP_ADMIN_EMAIL:'',SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'',GOOGLE_CLIENT_ID:'',GOOGLE_SECRET:'',OPENAI_API_KEY:'',
  };
  let source=createSupabaseEnvironment(template);
  source=source.replace(/^([A-Z_0-9]+)=.*$/gm,(line,key)=>Object.hasOwn(values,key)?`${key}=${values[key]}`:line);
  for(const [key,value]of Object.entries(values))if(!new RegExp(`^${key}=`, 'm').test(source))source+=`\n${key}=${value}\n`;
  return '# Generated deployment secrets. Keep private; never commit or rotate by rerunning setup.\n'+source;
}
export function deploymentProcessEnvironment(values, ambient=process.env) {
  const env={...ambient};
  for(const key of Object.keys(env))if(key.startsWith('COMPOSE_')||key==='SUPABASE_COMPOSE_ENV_FILE'||/^(NEXT_PUBLIC_|SUPABASE_|BACKEND_PROVIDER|EMAIL_CONFIRMATION_REQUIRED|PASSWORD_AUTH_ENABLED|GOOGLE_|SMTP_|POSTGRES_|POOLER_|JWT_|ANON_KEY|SERVICE_ROLE_KEY|DASHBOARD_|SECRET_KEY_BASE|REALTIME_|VAULT_|PG_META_|S3_PROTOCOL_|APP_URL|SITE_URL|PORT$|WEB_BIND_ADDRESS|API_GW_|DEV_AUTO_JOIN_|ROOT_ADMIN_|AGENT_)/.test(key))delete env[key];
  return {...env,...values,COMPOSE_PROJECT_NAME:values.COMPOSE_PROJECT_NAME};
}
export function readDeployment(name, base=root) {
  const directory=deploymentPath(name,base);
  if(!existsSync(resolve(directory,'.env'))||!existsSync(resolve(directory,'compose.yaml')))throw new Error('Deployment is not prepared. Run deploy:setup first.');
  const values=parseEnv(readFileSync(resolve(directory,'.env'),'utf8'));
  if(values.COMPOSE_PROJECT_NAME!==`teamspace-${deploymentName(name)}`||values.DEPLOYMENT_ENVIRONMENT!==name)throw new Error('Deployment identity does not match its directory.');
  return {directory,values,environment:deploymentProcessEnvironment(values)};
}
export function deploymentProblems(name, values, launch=true) {
  const errors=[];
  const requireValue=key=>{if(!values[key]?.trim())errors.push(`Set ${key}.`);};
  for(const key of ['POSTGRES_PASSWORD','JWT_SECRET','DASHBOARD_PASSWORD','SECRET_KEY_BASE','REALTIME_DB_ENC_KEY','VAULT_ENC_KEY','PG_META_CRYPTO_KEY','S3_PROTOCOL_ACCESS_KEY_ID','S3_PROTOCOL_ACCESS_KEY_SECRET','ANON_KEY','SERVICE_ROLE_KEY'])requireValue(key);
  for(const key of ['POSTGRES_PASSWORD','JWT_SECRET','DASHBOARD_PASSWORD','PG_META_CRYPTO_KEY','S3_PROTOCOL_ACCESS_KEY_SECRET'])if((values[key]?.length??0)<32)errors.push(`${key} is too short.`);
  if(values.REALTIME_DB_ENC_KEY?.length!==16||values.VAULT_ENC_KEY?.length!==32)errors.push('Realtime/Vault encryption keys have invalid lengths.');
  if(Buffer.from(values.SECRET_KEY_BASE??'','base64').length<48)errors.push('SECRET_KEY_BASE must contain at least 48 random bytes.');
  for(const [key,role]of [['ANON_KEY','anon'],['SERVICE_ROLE_KEY','service_role']])try{
    const [header,payload,signature,...extra]=values[key].split('.');
    const h=JSON.parse(Buffer.from(header,'base64url')),p=JSON.parse(Buffer.from(payload,'base64url'));
    const expected=createHmac('sha256',values.JWT_SECRET).update(`${header}.${payload}`).digest();
    const actual=Buffer.from(signature,'base64url');
    if(extra.length||h.alg!=='HS256'||p.role!==role||!Number.isFinite(p.exp)||p.exp<=Date.now()/1000||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error();
  }catch{errors.push(`${key} is expired or does not match JWT_SECRET and its role.`);}
  if(values.ANON_KEY!==values.NEXT_PUBLIC_SUPABASE_ANON_KEY||values.SERVICE_ROLE_KEY!==values.SUPABASE_SERVICE_ROLE_KEY)errors.push('Public/server app keys must match the generated Supabase keys.');
  if(values.BACKEND_PROVIDER!=='supabase'||values.NEXT_PUBLIC_BACKEND_PROVIDER!=='supabase')errors.push('This deployment uses the Supabase backend.');
  if(values.POSTGRES_HOST!=='db'||values.POSTGRES_PORT!=='5432')errors.push('Keep internal POSTGRES_HOST=db and POSTGRES_PORT=5432.');
  if(values.WEB_BIND_ADDRESS!=='127.0.0.1')errors.push('Keep website binding on loopback behind the HTTPS reverse proxy.');
  try{if(port(values.PORT)===port(values.API_GW_HTTP_PORT))errors.push('Website/API ports must differ.');}catch(error){errors.push(error.message);}
  for(const key of ['SITE_URL','NEXT_PUBLIC_SUPABASE_URL'])try{
    const normalized=publicUrl(values[key],name==='production');
    if(normalized!==values[key])errors.push(`${key} must be an origin without a trailing slash.`);
    if(launch&&/(^|\.)example\.(com|org|net)$/.test(new URL(normalized).hostname))errors.push(`Replace the placeholder ${key}.`);
  }catch{errors.push(`Set a valid ${key}; production requires HTTPS.`);}
  if(values.SITE_URL===values.NEXT_PUBLIC_SUPABASE_URL)errors.push('Website and API origins must differ.');
  if(values.APP_URL!==values.SITE_URL||values.SUPABASE_URL!==values.NEXT_PUBLIC_SUPABASE_URL||values.SUPABASE_PUBLIC_URL!==values.NEXT_PUBLIC_SUPABASE_URL||values.API_EXTERNAL_URL!==`${values.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`||values.ADDITIONAL_REDIRECT_URLS!==`${values.SITE_URL}/`)errors.push('Keep website/API/Auth URL settings aligned; see deployment README.');
  if(!['true','false'].includes(values.EMAIL_CONFIRMATION_REQUIRED))errors.push('EMAIL_CONFIRMATION_REQUIRED must be true or false.');
  if(values.DEV_AUTO_JOIN_WORKSPACE_ID)errors.push('Development auto-join must be empty.');
  if(launch&&values.PASSWORD_AUTH_ENABLED==='true'&&values.EMAIL_CONFIRMATION_REQUIRED==='true')for(const key of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_ADMIN_EMAIL'])requireValue(key);
  if(values.GOOGLE_AUTH_ENABLED==='true')for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_SECRET'])requireValue(key);
  if(!['true','false'].includes(values.GOOGLE_AUTH_ENABLED)||!['true','false'].includes(values.PASSWORD_AUTH_ENABLED))errors.push('Authentication feature flags must be true or false.');
  if(values.GOOGLE_AUTH_ENABLED==='false'&&values.PASSWORD_AUTH_ENABLED==='false')errors.push('Enable at least one implemented authentication method.');
  if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(values.RELEASE_TAG??''))errors.push('RELEASE_TAG must be a valid image tag.');
  if(!/^\d+$/.test(values.AGENT_AUDIT_RETENTION_DAYS??'')||Number(values.AGENT_AUDIT_RETENTION_DAYS)<1||Number(values.AGENT_AUDIT_RETENTION_DAYS)>365)errors.push('AGENT_AUDIT_RETENTION_DAYS must be 1–365.');
  return [...new Set(errors)];
}
export function scopedSupabaseCompose(source) {
  let count=0;
  const result=source.replace(/^    container_name: (.+)$/gm,(_,name)=>{
    count++;return name.startsWith('realtime-dev.')?'    container_name: realtime-dev.${COMPOSE_PROJECT_NAME}-realtime':`    container_name: \${COMPOSE_PROJECT_NAME}-${name.replace(/^supabase-/,'')}`;
  });
  if(count!==11)throw new Error('Pinned upstream service list changed; review deployment isolation.');
  return result;
}
export function generatedCompose(repositoryRoot) {
  const template=readFileSync(resolve(repositoryRoot,'docker.compose.supabase.yml'),'utf8').split(/^include:/m)[0];
  const source=template.slice(template.indexOf('name: teamspace-supabase'));
  const web=source.replace('name: teamspace-supabase','name: ${COMPOSE_PROJECT_NAME}').replace('      context: .',`      context: ${JSON.stringify(repositoryRoot.replaceAll('\\','/'))}`).replace('  web:\n','  web:\n    image: ${COMPOSE_PROJECT_NAME}-web:${RELEASE_TAG:-local}\n').replace('  web:\r\n','  web:\r\n    image: ${COMPOSE_PROJECT_NAME}-web:${RELEASE_TAG:-local}\r\n');
  return web+`  cleanup:
    image: \${COMPOSE_PROJECT_NAME}-web:\${RELEASE_TAG:-local}
    restart: unless-stopped
    command: ["node", "scripts/cleanup-loop.mjs"]
    environment:
      BACKEND_PROVIDER: supabase
      SUPABASE_URL: \${SUPABASE_URL}
      NEXT_PUBLIC_SUPABASE_URL: \${NEXT_PUBLIC_SUPABASE_URL}
      SUPABASE_INTERNAL_URL: http://api-gw:8000
      SUPABASE_SERVICE_ROLE_KEY: \${SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_STORAGE_BUCKET: \${SUPABASE_STORAGE_BUCKET}
    depends_on:
      web:
        condition: service_healthy
include:
  - path: [./supabase/docker-compose.yml, ./supabase.override.yml]
    project_directory: ./supabase
    env_file: ./.env
`;
}
export function createDeployment(name, options={}, base=root, checkout=resolve(root,'.supabase/upstream')) {
  const directory=deploymentPath(name,base);
  if(existsSync(directory))throw new Error('Deployment directory already exists. Existing keys/configuration/data were not changed. Use deploy doctor/up.');
  // Validate options before writing anything. Cryptographic values are never logged.
  const environment=deploymentEnvironment(name,options);
  const tree=spawnSync('git',['-C',checkout,'ls-tree','-r','--name-only',SUPABASE_COMMIT,'docker'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(tree.error||tree.status!==0)throw new Error('Pinned Supabase source is missing. Run prepare-supabase first.');
  mkdirSync(directory,{recursive:true,mode:0o700});
  for(const path of tree.stdout.trim().split('\n').filter(path=>path==='docker/docker-compose.yml'||path.startsWith('docker/volumes/'))){
    const target=resolve(directory,'supabase',path.slice('docker/'.length));
    if(!relative(directory,target)||relative(directory,target).startsWith(`..${sep}`)||!target.startsWith(directory+sep))throw new Error('Invalid upstream configuration path.');
    const result=spawnSync('git',['-C',checkout,'show',`${SUPABASE_COMMIT}:${path}`],{stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
    if(result.error||result.status!==0)throw new Error('Could not copy a pinned configuration file. Inspect the incomplete deployment directory before retrying.');
    mkdirSync(dirname(target),{recursive:true,mode:0o755});
    writeFileSync(target,path==='docker/docker-compose.yml'?scopedSupabaseCompose(result.stdout.toString()):result.stdout,{flag:'wx',mode:0o644});
  }
  const license=spawnSync('git',['-C',checkout,'show',`${SUPABASE_COMMIT}:LICENSE`],{stdio:['ignore','pipe','pipe']});
  if(license.status!==0)throw new Error('Pinned upstream license is missing.');
  writeFileSync(resolve(directory,'supabase/LICENSE'),license.stdout,{flag:'wx',mode:0o600});
  let override=readFileSync(resolve(root,'deploy/supabase.override.yml'),'utf8');
  override=override.replace('  supavisor:\n    ports: !override\n      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"\n      - "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION:-6543}:6543"','  supavisor:\n    ports: !reset []').replace('  supavisor:\r\n    ports: !override\r\n      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"\r\n      - "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION:-6543}:6543"','  supavisor:\r\n    ports: !reset []');
  if(override.includes('${POSTGRES_PORT:-5432}:5432'))throw new Error('Could not remove database host ports.');
  writeFileSync(resolve(directory,'supabase.override.yml'),override,{flag:'wx',mode:0o600});
  writeFileSync(resolve(directory,'compose.yaml'),generatedCompose(root),{flag:'wx',mode:0o600});
  writeFileSync(resolve(directory,'deployment.json'),JSON.stringify({version:1,environment:name,upstreamCommit:SUPABASE_COMMIT},null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(directory,'.env'),environment,{flag:'wx',mode:0o600});
  return directory;
}
