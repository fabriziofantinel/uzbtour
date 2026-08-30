import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url=process.env.DATABASE_URL??process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;
if(!url)throw new Error("Connessione Neon non configurata");
const client=new Client(url);let open=false;
try{
  await client.connect();
  const candidate=(await client.query(`SELECT actor.id actor_id,departure.agency_id,departure.id departure_id,
      (SELECT day.id FROM travel.departure_days day WHERE day.departure_id=departure.id ORDER BY day.service_date LIMIT 1) day_id
    FROM public.agency_memberships membership
    JOIN public.platform_users actor ON actor.id=membership.user_id AND actor.status='active'
    JOIN public.departures departure ON departure.agency_id=membership.agency_id
    WHERE membership.role IN('owner','admin','editor') ORDER BY departure.created_at DESC LIMIT 1`)).rows[0];
  if(!candidate)throw new Error("Nessuna partenza amministrabile disponibile");
  await client.query("BEGIN");open=true;
  const ownerFallback=!process.env.DATABASE_URL;
  if(ownerFallback){await client.query("GRANT smf_app TO current_user");await client.query("SET LOCAL ROLE smf_app");}
  const suffix=randomUUID().replaceAll("-","");
  const partyId=(await client.query("SELECT app.create_journey_party($1,$2,$3,$4,$5)::text id",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,`LIFE-${suffix.slice(0,10)}`,"Gruppo lifecycle rollback"])).rows[0].id;
  const people=[];
  for(const [index,role] of ["organizer","member","member"].entries()){
    const username=`life_${suffix.slice(0,18)}_${index+1}`;
    const token=randomBytes(32).toString("hex");
    const traveler=(await client.query(`SELECT traveler_id::text FROM app.provision_journey_traveler(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[candidate.actor_id,candidate.agency_id,partyId,
      `Lifecycle ${index+1}`,`L${index+1}`,username,`${username}@invalid.example`,"",index===2?"2015-01-01":null,role,token,
      new Date(Date.now()+3600000).toISOString()])).rows[0];
    const activated=(await client.query("SELECT * FROM app.activate_account_invitation($1,$2,$3)",
      [token,`lifecycle-subject-${suffix}-${index}`,username])).rows[0];
    if(!traveler?.traveler_id||activated?.username!==username)throw new Error("Attivazione fixture lifecycle fallita");
    people.push({username,travelerId:traveler.traveler_id});
  }
  if(ownerFallback)await client.query("RESET ROLE");
  const actors=(await client.query(`SELECT map.legacy_id id,users.username,users.status user_status,
      membership.status membership_status,membership.role
    FROM iam.users users
    JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=users.id
    JOIN travel.traveler_profiles profile ON profile.user_id=users.id
    JOIN travel.party_memberships membership ON membership.traveler_id=profile.id AND membership.party_id=$2
    WHERE users.username=ANY($1::text[])`,[people.map((person)=>person.username),partyId])).rows;
  const leaderActor=actors.find((actor)=>actor.username===people[0].username)?.id;
  if(!leaderActor||actors.some((actor)=>actor.user_status!=="active"||actor.membership_status!=="active"))
    throw new Error(`Attivazione capogruppo non riconciliata: ${JSON.stringify(actors)}`);
  if(ownerFallback)await client.query("SET LOCAL ROLE smf_app");
  await client.query("SELECT set_config('app.agency_id',$1,true)",[candidate.agency_id]);

  const consentId=(await client.query("SELECT app.set_minor_image_consent_v3($1,$2,$3,$4,$5,'granted','fixture rollback')::text id",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,partyId,people[2].travelerId])).rows[0]?.id;
  const mediaId=randomUUID(),documentId=randomUUID();
  const objectKey=`agencies/${candidate.agency_id}/departures/${candidate.departure_id}/parties/${partyId}/days/${candidate.day_id}/documents/${randomUUID()}.pdf`;
  const registered=(await client.query(`SELECT document_id::text FROM app.register_departure_day_document(
    $1,$2,$3,$4,$5,$6,'r2','smf-test',$7,'voucher.pdf','application/pdf',128,'Voucher collaudo')`,
    [candidate.actor_id,candidate.departure_id,candidate.day_id,partyId,mediaId,documentId,objectKey])).rows[0]?.document_id;
  const download=(await client.query("SELECT * FROM app.resolve_legacy_travel_document_download($1,$2)",
    [leaderActor,documentId])).rows[0];
  const foreignDownload=(await client.query("SELECT * FROM app.resolve_legacy_travel_document_download($1,$2)",
    [randomUUID(),documentId])).rowCount;
  const archived=(await client.query("SELECT app.archive_day_document_v3($1,$2,$3,$4) archived",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,documentId])).rows[0]?.archived;
  const hiddenAfterArchive=(await client.query("SELECT * FROM app.resolve_legacy_travel_document_download($1,$2)",
    [leaderActor,documentId])).rowCount===0;

  const competition=(await client.query("SELECT app.update_own_trip_competition_v3($1,$2,$3,true) updated",
    [leaderActor,candidate.departure_id,partyId])).rows[0]?.updated;
  const transferred=(await client.query("SELECT app.transfer_own_group_leadership_v3($1,$2,$3,$4) transferred",
    [leaderActor,candidate.departure_id,partyId,people[1].travelerId])).rows[0]?.transferred;
  const removedMember=(await client.query("SELECT app.remove_journey_traveler_v3($1,$2,$3,$4,$5) removed",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,partyId,people[0].travelerId])).rows[0]?.removed;
  const removedMinor=(await client.query("SELECT app.remove_journey_traveler_v3($1,$2,$3,$4,$5) removed",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,partyId,people[2].travelerId])).rows[0]?.removed;
  const removedLeader=(await client.query("SELECT app.remove_journey_traveler_v3($1,$2,$3,$4,$5) removed",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,partyId,people[1].travelerId])).rows[0]?.removed;
  const deleted=(await client.query("SELECT app.delete_empty_journey_party_v3($1,$2,$3,$4) deleted",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,partyId])).rows[0]?.deleted;
  if(ownerFallback)await client.query("RESET ROLE");
  const auditCount=Number((await client.query(`SELECT count(*) count FROM ops.audit_events
    WHERE agency_id=$1 AND entity_id=ANY($2::text[]) AND action IN
      ('trip_competition_settings_updated','leader_transferred_by_traveler','removed_from_journey','archived','minor_image_consent_updated')`,
    [candidate.agency_id,[partyId,...people.map((person)=>person.travelerId)]])).rows[0].count);
  if(!consentId||registered!==documentId||!download||foreignDownload!==0||!archived||!hiddenAfterArchive||
    !competition||!transferred||!removedMember||!removedMinor||!removedLeader||!deleted||auditCount<7)
    throw new Error(`Lifecycle incompleto: ${JSON.stringify({consentId,registered,download:Boolean(download),foreignDownload,
      archived,hiddenAfterArchive,competition,transferred,removedMember,removedMinor,removedLeader,deleted,auditCount})}`);
  await client.query("ROLLBACK");open=false;
  console.log(JSON.stringify({status:"passed",rolledBack:true,competitionUpdated:true,leadershipTransferred:true,
    minorConsentRecorded:true,documentRegistered:true,documentScoped:true,documentArchived:true,
    travelersRemoved:3,groupDeleted:true,auditEvents:auditCount}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
finally{await client.end().catch(()=>undefined);}
