import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDeployment, readDeployment, deploymentProcessEnvironment } from '../scripts/deployment-config.mjs';
import { composeCommand, validateCompose } from '../scripts/deploy.mjs';

test('real Compose models isolate staging/production data, identities, keys and host ports',()=>{
  const base=mkdtempSync(resolve(tmpdir(),'teamspace-deployment-tests-'));
  try{
    const configurations=[];
    for(const name of ['staging','production']){
      createDeployment(name,{},base);
      const deployment=readDeployment(name,base);
      const original=readFileSync(resolve(deployment.directory,'.env'));
      assert.throws(()=>createDeployment(name,{},base),/already exists/);
      assert.deepEqual(readFileSync(resolve(deployment.directory,'.env')),original);
      const env=deploymentProcessEnvironment(deployment.values,{...process.env,COMPOSE_FILE:'wrong.yml',SMTP_PASS:'foreign-prod-password',PORT:'9001'});
      const result=spawnSync('docker',composeCommand(deployment,['config','--format','json']),{cwd:deployment.directory,env,encoding:'utf8'});
      assert.equal(result.status,0,'Compose configuration failed (private diagnostics suppressed).');
      const config=JSON.parse(result.stdout);
      validateCompose(config,deployment);
      assert.equal(config.services.auth.environment.GOTRUE_SMTP_PASS,'');
      assert.equal(config.services.auth.environment.GOTRUE_SMTP_HOST,name==='staging'?'mailpit':'');
      if(name==='staging'){
        assert.equal(config.services.mailpit.ports.length,1);
        assert.equal(config.services.mailpit.ports[0].host_ip,'127.0.0.1');
        assert.equal(config.services.mailpit.ports[0].target,8025);
        assert.equal(config.services.auth.depends_on.mailpit.condition,'service_healthy');
      }else assert.equal(config.services.mailpit,undefined);
      assert.equal(config.services.supavisor.ports,undefined);
      assert.equal(config.services.web.build.args.NEXT_PUBLIC_SUPABASE_ANON_KEY,deployment.values.ANON_KEY);
      assert.ok(!Object.values(config.services.web.build.args).includes(deployment.values.SERVICE_ROLE_KEY));
      assert.equal(config.services.cleanup.environment.SUPABASE_SERVICE_ROLE_KEY,deployment.values.SERVICE_ROLE_KEY);
      configurations.push(config);
    }
    const [staging,production]=configurations;
    const storage=config=>Object.values(config.services).flatMap(service=>(service.volumes??[]).map(volume=>volume.type==='volume'?config.volumes[volume.source].name:volume.source));
    for(const path of storage(staging))assert.ok(!storage(production).includes(path));
    assert.notEqual(staging.networks.default.name,production.networks.default.name);
    assert.notEqual(staging.services.web.ports[0].published,production.services.web.ports[0].published);
    assert.notEqual(staging.services['api-gw'].ports[0].published,production.services['api-gw'].ports[0].published);
  }finally{
    const parent=resolve(tmpdir()),target=resolve(base);
    assert.ok(target.startsWith(parent+sep)&&!relative(parent,target).startsWith('..'));
    rmSync(target,{recursive:true,force:true});
  }
});
