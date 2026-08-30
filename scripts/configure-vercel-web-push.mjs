import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import webpush from "web-push";

const keys=webpush.generateVAPIDKeys();
const values={
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:{value:keys.publicKey,sensitive:false},
  VAPID_PRIVATE_KEY:{value:keys.privateKey,sensitive:true},
  WEB_PUSH_SUBJECT:{value:"mailto:ai.fabrizio.fantinel@gmail.com",sensitive:false},
  CRON_SECRET:{value:randomBytes(32).toString("hex"),sensitive:true},
};
for(const [name,config] of Object.entries(values)){
  const args=["vercel","env","add",name,"production,preview,development","--value",config.value,"--yes","--force",config.sensitive?"--sensitive":"--no-sensitive"];
  const result=spawnSync(process.platform==="win32"?"npx.cmd":"npx",args,{cwd:process.cwd(),stdio:["ignore","pipe","pipe"]});
  if(result.status!==0)throw new Error(`Configurazione ${name} non riuscita: ${result.stderr.toString().trim()}`);
  console.log(JSON.stringify({variable:name,status:"configured",environments:["production","preview","development"]}));
}
