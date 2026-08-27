import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name="054_v3_identity_result_contract_fix",model="3.26.0-identity-result-contract-fix";
const apply=process.argv.includes("--apply");
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Connessione diretta Neon owner non configurata");
const source=await readFile(new URL(`../database/migrations/${name}.sql`,import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex"),client=new Client(url);let open=false;
try{
  await client.connect();
  const role=(await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if(!role||role.runtime)throw new Error("Ruolo owner richiesto");
  const started=performance.now();
  await client.query("BEGIN");open=true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-identity-result-contract-fix',0))");
  await client.query(source);

  const candidate=(await client.query(`SELECT users.id,users.normalized_email,identity.subject
    FROM iam.users users
    JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=users.id
    LEFT JOIN LATERAL (SELECT subject FROM iam.user_identities
      WHERE user_id=users.id AND provider='neon' ORDER BY created_at DESC LIMIT 1) identity ON true
    WHERE users.status='active' AND users.normalized_email IS NOT NULL AND identity.subject IS NOT NULL
    ORDER BY users.created_at LIMIT 1`)).rows[0];
  if(!candidate)throw new Error("Nessun utente IAM attivo e collegato disponibile per il gate");
  const subject=candidate.subject;
  const resolved=(await client.query(
    "SELECT * FROM app.resolve_neon_authenticated_user($1,$2,$3)",
    [subject,candidate.normalized_email,"Identity contract check"],
  )).rows[0];
  if(!resolved?.legacy_user_id||!resolved.display_name||!resolved.email||!resolved.platform_role)
    throw new Error("Il resolver IAM non rispetta il contratto dichiarato");
  const runtimeExecute=(await client.query(
    "SELECT has_function_privilege('smf_app','app.resolve_neon_authenticated_user(text,text,text)','EXECUTE') allowed",
  )).rows[0]?.allowed===true;
  if(!runtimeExecute)throw new Error("Permesso runtime sul resolver IAM mancante");

  const executionMs=Math.round(performance.now()-started);
  if(apply){
    await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
      VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE
      SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,[model,checksum,executionMs]);
    await client.query("COMMIT");
  }else await client.query("ROLLBACK");
  open=false;
  console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",role:role.role_name,
    executionMs,gates:{resolvedUser:true,runtimeExecute},migration:{name,model,checksum}},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}
finally{await client.end().catch(()=>{});}
