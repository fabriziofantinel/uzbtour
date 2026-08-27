import {Client} from "@neondatabase/serverless";
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;if(!url)throw new Error("Connessione diretta Neon owner non configurata");
const client=new Client(url);let open=false;
try{
  await client.connect();await client.query("BEGIN");open=true;
  const actor=(await client.query(`SELECT map.legacy_id FROM ops.legacy_id_map map JOIN iam.users u ON u.id=map.target_id WHERE map.source_system='public-v2' AND map.entity_type='user' AND u.platform_role='superadmin' AND u.status='active' ORDER BY u.created_at LIMIT 1`)).rows[0];
  if(!actor)throw new Error("Superadmin di collaudo non disponibile");
  const agencyId=crypto.randomUUID(),templateId=crypto.randomUUID(),versionId=crypto.randomUUID(),refJobId=crypto.randomUUID();
  await client.query(`INSERT INTO iam.agencies(id,slug,name,reference_name,status) VALUES($1,$2,'Acceptance BR-019','Acceptance','active')`,[agencyId,`acceptance-${agencyId.slice(0,8)}`]);
  await client.query(`INSERT INTO ops.platform_jobs(id,agency_id,job_type,provider,status,payload,idempotency_key) VALUES($1,$2,'travel-reference.enrich','sqs','processing','{}','acceptance-reference')`,[refJobId,agencyId]);
  const trip=(await client.query(`SELECT * FROM app.create_trip_template_v3($1,$2,$3,$4,'acceptance-trip','Acceptance trip','Europe/Rome')`,[actor.legacy_id,agencyId,templateId,versionId])).rows[0];
  if(!trip||trip.id!==templateId)throw new Error("Creazione viaggio V3 non riuscita");
  const country=(await client.query(`SELECT * FROM app.upsert_reference_catalog_v3($1,$2,'country',NULL,'AQ','Antartide','antartide','https://www.google.com/search?q=Antartide',NULL,NULL)`,[actor.legacy_id,agencyId])).rows[0];
  if(!country?.id)throw new Error("Upsert catalogo V3 non riuscito");
  await client.query(`SELECT app.save_reference_content_v3($1,$2,'country',$3,'useful_info',$4::jsonb,'acceptance-model',clock_timestamp()+interval '180 days')`,[refJobId,agencyId,country.id,JSON.stringify([{title:"Test",body:"Test"}])]);
  const deleted=(await client.query(`SELECT app.delete_trip_template_v3($1,$2,$3,ARRAY[]::uuid[]) deleted`,[actor.legacy_id,agencyId,templateId])).rows[0];
  if(!deleted?.deleted)throw new Error("Eliminazione viaggio V3 non riuscita");
  const deletion=(await client.query(`SELECT * FROM app.request_agency_deletion_v3($1,$2,'Acceptance rollback BR-019')`,[actor.legacy_id,agencyId])).rows[0];
  const worker="acceptance-worker";
  const claim=(await client.query(`SELECT * FROM app.claim_agency_deletion_v3($1,$2,$3,600)`,[deletion.job_id,agencyId,worker])).rows[0];
  if(!claim)throw new Error("Claim cancellazione agenzia non riuscito");
  let state=claim;
  for(let i=0;i<30&&state.status!=="completed"&&state.status!=="blocked";i+=1){
    state=(await client.query(`SELECT * FROM app.advance_agency_deletion_v3($1,$2,$3,25)`,[deletion.job_id,agencyId,worker])).rows[0];
  }
  if(state.status!=="completed"||state.phase!=="completed")throw new Error(`Cancellazione non completata: ${JSON.stringify(state)}`);
  const checks=(await client.query(`SELECT NOT EXISTS(SELECT 1 FROM iam.agencies WHERE id=$1) agency_removed,(SELECT status='completed' FROM ops.agency_deletion_jobs WHERE id=$2) job_completed`,[agencyId,deletion.job_id])).rows[0];
  if(!checks?.agency_removed||!checks?.job_completed)throw new Error(`Postcondizioni non rispettate: ${JSON.stringify(checks)}`);
  await client.query("ROLLBACK");open=false;
  console.log(JSON.stringify({status:"passed",tripCrud:true,referenceDirectWrite:true,agencyDeletionBr019:true,finalPhase:state.phase,transaction:"rolled_back"},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}finally{await client.end().catch(()=>{});}
