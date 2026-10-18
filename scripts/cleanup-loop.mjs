import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let stopped=false,timer,child;
function stop(){stopped=true;clearTimeout(timer);if(child)child.kill('SIGTERM');}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
function run(){
  if(stopped)return;
  child=spawn(process.execPath,[fileURLToPath(new URL('./prune-supabase.mjs',import.meta.url))],{stdio:['ignore','ignore','ignore']});
  let finished=false;
  const complete=success=>{
    if(finished)return;finished=true;child=undefined;
    console.log(success?'Scheduled expiry/staging cleanup completed.':'Scheduled expiry/staging cleanup failed; retrying in one hour.');
    if(!stopped)timer=setTimeout(run,60*60*1000);
  };
  child.once('error',()=>complete(false));child.once('close',code=>complete(code===0));
}
run();
