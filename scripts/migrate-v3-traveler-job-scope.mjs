import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply=process.argv.includes("--apply"),url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;
if(!url)throw new Error("Connessione Neon owner non configurata");
const source=await readFile(new URL("../database/migrations/122_v3_traveler_job_scope.sql",import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex"),client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query(source);
 const fixture=(await client.query(`SELECT media.agency_id,media.departure_id,media.party_id,map.legacy_id
   FROM ops.media_assets media JOIN ops.legacy_id_map map ON map.source_system='public-v2'
    AND map.entity_type='user' AND map.target_id=media.uploaded_by_user_id
   WHERE media.purpose='memory' ORDER BY media.created_at DESC LIMIT 1`)).rows[0];
 if(!fixture)throw new Error("Fixture viaggiatore non disponibile");
 const payload={departureId:fixture.departure_id,partyId:fixture.party_id,probe:true};
 const rows=(await client.query(`SELECT * FROM app.enqueue_platform_job_v3($1,$2,'photo-evidence.validate','database',$3::jsonb,$4,clock_timestamp())`,
   [fixture.legacy_id,fixture.agency_id,JSON.stringify(payload),`scope-probe-${randomUUID()}`])).rows;
 const gate={executable:rows.length===1};if(!gate.executable)throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
 await client.query("DELETE FROM ops.platform_jobs WHERE id=$1",[rows[0].id]);
 if(apply){await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES('3.72.0-traveler-job-scope',$1,0)
 ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,[checksum]);await client.query("COMMIT");}
 else await client.query("ROLLBACK");open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{await client.end().catch(()=>undefined);}
