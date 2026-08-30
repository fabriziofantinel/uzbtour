import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply=process.argv.includes("--apply");
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;
if(!url)throw new Error("Connessione Neon owner non configurata");
const source=await readFile(new URL("../database/migrations/116_v3_minor_guardianship_attestation.sql",import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex");const client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(source);const gate=(await client.query(`SELECT
    has_function_privilege('smf_app','app.set_minor_image_consent_v3(text,uuid,uuid,uuid,uuid,text,text)','EXECUTE') function_ok,
    pg_get_functiondef('app.set_minor_image_consent_v3(text,uuid,uuid,uuid,uuid,text,text)'::regprocedure)
      LIKE '%traveler_guardianships%' guardianship_ok`)).rows[0];
  if(!gate||Object.values(gate).some((value)=>value!==true))throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if(apply){await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
    VALUES('3.66.0-minor-guardianship-attestation',$1,0) ON CONFLICT(version) DO UPDATE
    SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,[checksum]);await client.query("COMMIT");}
  else await client.query("ROLLBACK");open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
finally{await client.end().catch(()=>undefined);}
