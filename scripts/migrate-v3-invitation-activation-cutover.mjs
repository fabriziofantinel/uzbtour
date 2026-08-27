import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name="038_v3_invitation_activation_cutover";
const model="3.11.0-invitation-activation-cutover";
const apply=process.argv.includes("--apply");
const migrationUrl=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;
if(!migrationUrl) throw new Error("Connessione diretta Neon owner non configurata");
const source=await readFile(new URL(`../database/migrations/${name}.sql`,import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex");
const client=new Client(migrationUrl); let open=false;
try{
  await client.connect();
  const capability=(await client.query(`SELECT current_user role_name,
    has_database_privilege(current_user,current_database(),'CREATE') can_create,
    current_user='smf_app' is_runtime_role`)).rows[0];
  if(!capability||capability.is_runtime_role||!capability.can_create)
    throw new Error(`Ruolo non autorizzato: ${capability?.role_name??"sconosciuto"}`);
  const started=performance.now(); await client.query("BEGIN"); open=true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-invitation-activation-cutover',0))");
  await client.query(source);
  const gates=(await client.query(`SELECT
    has_function_privilege('smf_app','app.inspect_account_invitation(text)','EXECUTE') inspect_invitation,
    has_function_privilege('smf_app','app.activate_account_invitation(text,text,text)','EXECUTE') activate_invitation,
    NOT has_table_privilege('smf_app','iam.invitations','SELECT') invitation_table_private,
    NOT has_table_privilege('smf_app','ops.legacy_id_map','SELECT') identity_map_private,
    (SELECT count(*) FROM iam.invitations i JOIN iam.users u ON u.id=i.invited_user_id
      WHERE i.used_at IS NULL AND i.expires_at>clock_timestamp() AND u.status='invited')=
    (SELECT count(*) FROM public.user_invitations i JOIN public.platform_users u ON u.id=i.user_id
      WHERE i.used_at IS NULL AND i.expires_at>clock_timestamp() AND u.status='invited') invitations_reconciled`)).rows[0];
  if(!gates||Object.values(gates).some((value)=>value!==true)) throw new Error(`Gate incompleti: ${JSON.stringify(gates)}`);
  const executionMs=Math.round(performance.now()-started);
  if(apply){
    const previous=await client.query("SELECT checksum_sha256 FROM ops.schema_migrations WHERE version=$1",[model]);
    if(previous.rowCount&&previous.rows[0].checksum_sha256!==checksum) throw new Error(`Checksum differente per ${model}`);
    await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
      VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model,checksum,executionMs]);
    await client.query("COMMIT");
  }else await client.query("ROLLBACK");
  open=false;
  console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",role:capability.role_name,
    executionMs,gates,migration:{name,model,checksum}},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
finally{await client.end().catch(()=>undefined);}
