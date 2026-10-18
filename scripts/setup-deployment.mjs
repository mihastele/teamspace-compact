import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeployment, deploymentName } from './deployment-config.mjs';
import { prepareSupabase } from './prepare-supabase.mjs';

export function setupArguments(args) {
  const name=deploymentName(args[0]);
  const flags={'--site-url':'siteUrl','--api-url':'apiUrl','--web-port':'webPort','--api-port':'apiPort'};
  const options={};
  for(let i=1;i<args.length;i+=2){
    const key=flags[args[i]];
    if(!key||!args[i+1]||Object.hasOwn(options,key))throw new Error('Use staging|production [--site-url URL] [--api-url URL] [--web-port PORT] [--api-port PORT].');
    options[key]=args[i+1];
  }
  return {name,options};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  const {name,options}=setupArguments(process.argv.slice(2));
  prepareSupabase({quiet:true});
  const directory=createDeployment(name,options);
  console.log(`Prepared ${name} at ${directory}.`);
  console.log('Generated private .env secrets, isolated compose.yaml and pinned Supabase configuration. No services started.');
  console.log('External SMTP/OAuth/API credentials remain blank. Set public URLs and mail credentials in this .env.');
  console.log(`Next: npm run deploy -- ${name} doctor, then npm run deploy -- ${name} up`);
}catch(error){console.error(`Setup failed: ${error.message} Existing keys/data were not overwritten. See deploy/README.md.`);process.exitCode=1;}
