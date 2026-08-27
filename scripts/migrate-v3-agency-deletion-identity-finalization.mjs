import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name="059_v3_agency_deletion_identity_finalization",model="3.30.0-agency-deletion-identity-finalization";
const apply=process.argv.includes("--apply");
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Connessione diretta Neon owner non configurata");
const source=await readFile(new URL(`../database/migrations/${name}.sql`,import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex"),client=new Client(url);let open=false;
try{
  await client.connect();await client.query("BEGIN");open=true;const started=performance.now();
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-agency-deletion-identities',0))");
  await client.query(source);
  const gate=(await client.query(`SELECT has_function_privilege('smf_app',
    'app.finalize_agency_deletion_identities_v3(uuid)','EXECUTE') runtime_finalize`)).rows[0];
  if(!gate.runtime_finalize)throw new Error("Finalizzazione identità non eseguibile dal runtime");
  const executionMs=Math.round(performance.now()-started);
  if(apply){await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
    VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
    [model,checksum,executionMs]);await client.query("COMMIT");}else await client.query("ROLLBACK");
  open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gates:gate,executionMs},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}
finally{await client.end().catch(()=>{});}
