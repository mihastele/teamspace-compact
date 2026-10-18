import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readDeployment, deploymentProblems, deploymentName } from './deployment-config.mjs';
import { migrationSQL } from './migrate-supabase.mjs';

const backend=['db','auth','rest','realtime','storage','imgproxy','meta','studio','supavisor','api-gw','functions'];
export function commandArguments(args) {
  if(args.length!==2||!['doctor','build','up','status','stop','migrate','backup','prune'].includes(args[1]))throw new Error('Use staging|production doctor|build|up|status|stop|migrate|backup|prune.');
  return {name:deploymentName(args[0]),action:args[1]};
}
export function composeCommand(deployment,args) {
  return ['compose','--project-name',deployment.values.COMPOSE_PROJECT_NAME,'--project-directory',deployment.directory,'--env-file',resolve(deployment.directory,'.env'),'-f',resolve(deployment.directory,'compose.yaml'),...args];
}
function compose(deployment,args,input, capture=true) {
  const result=spawnSync('docker',composeCommand(deployment,args),{cwd:deployment.directory,env:deployment.environment,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
  // Compose config, SQL diagnostics and container output can contain credentials.
  if(result.error||result.status!==0)throw new Error(dockerFailure(args[0],result));
  if(!capture&&result.stdout)process.stdout.write(result.stdout);
  return result.stdout;
}
export function dockerFailure(operation,result) {
  // Classify known failures without ever echoing potentially private child output.
  const diagnostic=`${result.error?.code??''}\n${result.stderr??''}\n${result.stdout??''}`;
  let hint='Check Docker readiness and the selected deployment configuration.';
  if(/ENOENT/.test(diagnostic))hint='Docker CLI was not found. Install Docker with Compose and ensure docker is on PATH.';
  else if(/cannot connect|error during connect|is the docker daemon running|dockerDesktopLinuxEngine/i.test(diagnostic))hint='Docker Engine is unavailable. Start Docker Desktop with Linux containers, then retry.';
  else if(/port is already allocated|address already in use|ports are not available/i.test(diagnostic))hint='A host port is already occupied. Check the selected website/API ports and other running services.';
  else if(/unauthorized|authentication required|pull access denied|toomanyrequests/i.test(diagnostic))hint='The container registry refused the image pull. Check registry authentication and pull limits.';
  else if(/unhealthy|dependency failed|did not start|is not running/i.test(diagnostic))hint='A service failed to become healthy. Run the deployment status command to identify it; inspect its logs privately.';
  return `Docker operation failed (${operation}). ${hint} Raw output was suppressed to protect secrets.`;
}
export function preflightFailure(name,directory,problems) {
  const mail=problems.some(problem=>/SMTP_/.test(problem));
  return `${name} configuration is incomplete:\n${problems.join('\n')}\nEdit ${resolve(directory,'.env')}.${mail?' Email confirmation requires a working SMTP provider; setup deliberately leaves external credentials blank. See deploy/README.md.':''}\nNo services were started by this command.`;
}
export function validateCompose(model,deployment) {
  const project=deployment.values.COMPOSE_PROJECT_NAME,services=model.services;
  if(model.name!==project)throw new Error('Compose project identity does not match the deployment.');
  if(!services?.web||!services.db||!services.cleanup)throw new Error('Deployment services are incomplete.');
  for(const [service,value]of Object.entries(services)){
    if(value.container_name&&!value.container_name.includes(project))throw new Error('Container names are not isolated.');
    for(const volume of value.volumes??[])if(volume.type==='bind'&&!resolve(volume.source).startsWith(resolve(deployment.directory)+ (process.platform==='win32'?'\\':'/')))throw new Error('A service bind mount escapes its deployment data directory.');
    for(const port of value.ports??[])if(port.host_ip!=='127.0.0.1'||!['web','api-gw'].includes(service))throw new Error('Only website/API loopback ports may be published.');
  }
  if(services.realtime.container_name!==`realtime-dev.${project}-realtime`)throw new Error('Realtime tenant hostname is invalid.');
  if(services.web.environment.SUPABASE_INTERNAL_URL!=='http://api-gw:8000'||services.web.environment.DEV_AUTO_JOIN_WORKSPACE_ID!=='')throw new Error('Private transport or production access settings are invalid.');
  if(Object.keys(services.web.build.args).some(key=>!key.startsWith('NEXT_PUBLIC_')))throw new Error('Only public settings may enter image build arguments.');
  for(const [key,value]of Object.entries(model.volumes??{}))if(value.name&&!value.name.startsWith(`${project}_`))throw new Error(`Volume ${key} is not isolated.`);
  if(model.networks?.default?.name!==`${project}_default`)throw new Error('Deployment network is not isolated.');
}
function doctor(deployment,name,launch) {
  const problems=deploymentProblems(name,deployment.values,launch);
  if(problems.length)throw new Error(preflightFailure(name,deployment.directory,problems));
  const configuration=JSON.parse(compose(deployment,['config','--format','json']));
  validateCompose(configuration,deployment);
  console.log(`${name}: keys, public settings, isolated storage/network, private ports and Compose configuration pass.`);
}
function sql(deployment,source) {return compose(deployment,['exec','-T','db','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],source);}
async function backup(deployment,name) {
  const directory=resolve(homedir(),'.teamspace','backups',name);
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path=resolve(directory,`${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}.sql`);
  const fd=openSync(path,'wx',0o600);
  try{
    await new Promise((done,reject)=>{
      const child=spawn('docker',composeCommand(deployment,['exec','-T','db','pg_dump','-U','postgres','-d','postgres','--clean','--if-exists']),{cwd:deployment.directory,env:deployment.environment,stdio:['ignore',fd,'ignore']});
      child.once('error',()=>reject(new Error('Database backup could not start. A partial private backup may remain.')));
      child.once('close',code=>code===0?done():reject(new Error('Database backup failed. Do not rely on the partial private backup. No migration was started.')));
    });
  }finally{closeSync(fd);}
  console.log(`Database backup saved privately to ${path}. Storage files require a separate backup; see deploy/README.md.`);
}
function publishPolicy(deployment) {
  const value=deployment.values.EMAIL_CONFIRMATION_REQUIRED==='true';
  sql(deployment,`begin; do $$ declare current_epoch bigint; result jsonb; begin
    select epoch into current_epoch from public.teamspace_store_state where singleton for update;
    result:=public.teamspace_store_commit(current_epoch,'[{"kind":"set","path":"security/policy","data":{"emailConfirmationRequired":${value}}}]'::jsonb);
    if coalesce((result->>'conflict')::boolean,false) then raise exception 'Policy conflict'; end if;
  end $$; commit;`);
}
async function migrate(deployment,name) {
  // Fresh databases also receive a backup; the small overhead keeps recovery uniform.
  await backup(deployment,name);
  sql(deployment,migrationSQL());
  publishPolicy(deployment);
  console.log('Tracked migrations and matching authentication read policy applied.');
}
export async function runDeployment(name,action) {
  const deployment=readDeployment(name);
  if(action==='status'){compose(deployment,['ps'],undefined,false);return;}
  if(action==='stop'){compose(deployment,['stop']);console.log(`${name} stopped; data and keys retained.`);return;}
  if(action==='backup'){await backup(deployment,name);return;}
  doctor(deployment,name,!['build'].includes(action));
  if(action==='doctor')return;
  if(action==='prune'){compose(deployment,['run','--rm','--no-deps','cleanup','node','scripts/prune-supabase.mjs']);console.log('Expiry/staging cleanup completed.');return;}
  if(action==='build'||action==='up'){
    console.log(`Building ${name} website with public configuration only; detailed build output is suppressed.`);
    compose(deployment,['build','web']);
    if(action==='build'){console.log('Production-mode image built. No services started or migrations applied.');return;}
  }
  // Build before taking an existing website offline. Never expose old writers during migrations.
  compose(deployment,['stop','web','cleanup']);
  try{
    console.log(`Starting ${name} backend services; first startup may download images and take several minutes.`);
    compose(deployment,['up','-d','--wait','--wait-timeout','240',...backend]);
    console.log('Backend is healthy. Backing up the database before applying migrations.');
    await migrate(deployment,name);
    if(action==='migrate'){console.log('Website/cleanup remain stopped. Use deploy up to build and start the matching client/API.');return;}
    console.log(`Starting ${name} website and scheduled cleanup.`);
    compose(deployment,['up','-d','--wait','--wait-timeout','180','web','cleanup']);
  }catch(error){throw new Error(`${error.message}\nWebsite/cleanup may remain stopped. Earlier numbered migrations may have committed. Preserve data and consult the backup/upgrade instructions before restarting.`);}
  console.log(`${name} is running. Website/API bindings are loopback only. Verify HTTPS, email delivery and authenticated two-user flows before release.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  const {name,action}=commandArguments(process.argv.slice(2));
  await runDeployment(name,action);
}catch(error){console.error(error.message);process.exitCode=1;}
