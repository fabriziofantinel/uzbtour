import{readFile}from"node:fs/promises";import{Client}from"@neondatabase/serverless";
const apply=process.argv.includes("--apply"),url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Connessione Neon non configurata");
const source=await readFile(new URL("../database/migrations/102_v3_agency_product_analytics.sql",import.meta.url),"utf8");
const client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query(source);
 const gate=(await client.query(`SELECT to_regclass('ops.product_analytics_events') IS NOT NULL table_ok,
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops' AND c.relname='product_analytics_events' AND c.relrowsecurity AND c.relforcerowsecurity) rls_ok,
  has_function_privilege('smf_app','app.record_product_analytics_event_v3(text,uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE') runtime_execute_ok,
  has_table_privilege('smf_app','ops.product_analytics_events','SELECT') runtime_read_ok`)).rows[0];
 if(!gate||Object.values(gate).some(value=>value!==true))throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
 await client.query(apply?"COMMIT":"ROLLBACK");open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}finally{await client.end().catch(()=>{});}
