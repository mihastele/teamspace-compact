import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readDeployment } from '../scripts/deployment-config.mjs';

// Opt-in after building both environments. All tokens travel over stdin; none
// enter test output or a Docker command line. Containers have no network/ports.
for(const name of ['staging','production'])test(`${name} image includes cleanup runtime and only its public build configuration`,()=>{
  const deployment=readDeployment(name),other=readDeployment(name==='staging'?'production':'staging');
  const forbidden=[deployment,other].flatMap(item=>['JWT_SECRET','POSTGRES_PASSWORD','SERVICE_ROLE_KEY','DASHBOARD_PASSWORD'].map(key=>item.values[key]));
  forbidden.push(other.values.ANON_KEY);
  const script=`
    import fs from 'node:fs';
    import {spawn} from 'node:child_process';
    if(process.getuid()===0)throw new Error('Website runtime must be unprivileged.');
    await import('@supabase/supabase-js');
    fs.accessSync('/app/scripts/cleanup-loop.mjs'); fs.accessSync('/app/scripts/prune-supabase.mjs');
    if(fs.existsSync('/app/deployments')||fs.existsSync('/app/.env.supabase'))throw new Error('Private deployment files entered the image.');
    const packet=JSON.parse(fs.readFileSync(0,'utf8')); let found=false;
    function scan(directory){for(const file of fs.readdirSync(directory,{withFileTypes:true})){
      const path=directory+'/'+file.name;
      if(file.isDirectory())scan(path);
      else if(file.isFile()){
        const bytes=fs.readFileSync(path);
        if(packet.forbidden.some(value=>bytes.includes(Buffer.from(value))))throw new Error('A private or other-environment value entered the image.');
        if(bytes.includes(Buffer.from(packet.publicKey)))found=true;
      }
    }}
    scan('/app'); if(!found)throw new Error('Expected public configuration is absent from the browser image.');
    const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3108',HOSTNAME:'127.0.0.1'},stdio:'ignore'});
    const exited=new Promise(resolve=>child.once('exit',resolve));
    try{
      let ready=false;
      for(let attempt=0;attempt<50;attempt++){
        try{const response=await fetch('http://127.0.0.1:3108/');if(response.status===200){ready=true;break;}}catch{}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!ready)throw new Error('Container HTTP smoke failed.');
    }finally{child.kill('SIGTERM');await exited;}
    console.log('Runtime/dependency/configuration isolation passed.');
  `;
  const result=spawnSync('docker',['run','--rm','-i','--network','none','--entrypoint','node',`${deployment.values.COMPOSE_PROJECT_NAME}-web:${deployment.values.RELEASE_TAG}`,'--input-type=module','-e',script],{input:JSON.stringify({forbidden,publicKey:deployment.values.ANON_KEY}),encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(result.status,0,'Image runtime/configuration check failed (private diagnostics suppressed).');
  assert.match(result.stdout,/isolation passed/);
});
