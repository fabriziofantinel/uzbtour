import{createHash}from"node:crypto";import{readFile}from"node:fs/promises";import{Client}from"@neondatabase/serverless";
const apply=process.argv.includes("--apply"),url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;if(!url)throw new Error("Connessione Neon owner non configurata");
const source=await readFile(new URL("../database/migrations/119_v3_normalized_media_registration.sql",import.meta.url),"utf8"),checksum=createHash("sha256").update(source).digest("hex"),client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query(source);
 const gate=(await client.query(`SELECT has_function_privilege('smf_app','app.register_legacy_memory_upload(text,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') memory_execute,
  has_function_privilege('smf_app','app.register_legacy_ticket_upload(text,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') ticket_execute,
  position('INSERT INTO journey.memories' in pg_get_functiondef('app.register_legacy_memory_upload(text,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)'::regprocedure))>0 memory_v3,
  position('INSERT INTO ops.travel_documents' in pg_get_functiondef('app.register_legacy_ticket_upload(text,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)'::regprocedure))>0 ticket_v3`)).rows[0];
 if(!gate||Object.values(gate).some(v=>v!==true))throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
 if(apply){await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES('3.69.0-normalized-media-registration',$1,0) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,[checksum]);await client.query("COMMIT");}else await client.query("ROLLBACK");open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(e){if(open)await client.query("ROLLBACK").catch(()=>{});throw e;}finally{await client.end().catch(()=>{});}
