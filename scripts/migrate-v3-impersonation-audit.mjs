import{readFile}from"node:fs/promises";import{Client}from"@neondatabase/serverless";
const apply=process.argv.includes("--apply"),url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Connessione Neon non configurata");
const source=await readFile(new URL("../database/migrations/100_v3_impersonation_audit.sql",import.meta.url),"utf8");
const client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query(source);
  const gate=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='impersonation_session_audit_v3' AND tgenabled<>'D') trigger_ok,
    has_function_privilege(current_user,'app.audit_impersonation_session_v3()','EXECUTE') owner_execute_ok`)).rows[0];
  if(!gate||Object.values(gate).some(value=>value!==true))throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  await client.query(apply?"COMMIT":"ROLLBACK");open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}finally{await client.end().catch(()=>{});}
