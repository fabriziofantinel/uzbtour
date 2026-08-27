import { randomUUID } from "node:crypto";import { Client } from "@neondatabase/serverless";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL runtime non configurata");const client=new Client(url);
try{await client.connect();const role=(await client.query("SELECT current_user role_name")).rows[0]?.role_name;
const unknown=randomUUID();const denied=(await client.query("SELECT * FROM app.read_superadmin_summary($1)",[unknown])).rowCount===0;
const actor=(await client.query("SELECT id FROM public.platform_users WHERE platform_role='superadmin' AND status='active' ORDER BY created_at LIMIT 1")).rows[0];if(!actor)throw new Error("Superadmin attivo non disponibile");
const summary=(await client.query("SELECT * FROM app.read_superadmin_summary($1)",[actor.id])).rows[0];const registry=await client.query("SELECT * FROM app.read_superadmin_agency_registry($1)",[actor.id]);const users=await client.query("SELECT * FROM app.read_superadmin_impersonation_users($1)",[actor.id]);
if(!denied||!summary||Number(summary.agencies)<1||registry.rowCount<1)throw new Error("Gate letture superadmin V3 non superati");console.log(JSON.stringify({status:"passed",role,unauthorizedReadDenied:denied,summary,registryRows:registry.rowCount,userRows:users.rowCount},null,2));
}finally{await client.end().catch(()=>undefined);}
