import{randomUUID}from"node:crypto";import{Client}from"@neondatabase/serverless";
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;if(!url)throw new Error("Connessione diretta Neon owner non configurata");
const client=new Client(url);let open=false;
try{await client.connect();await client.query("BEGIN");open=true;
const fixture=(await client.query(`SELECT membership.agency_id,membership.departure_id,membership.party_id,
  profile.user_id,mapping.legacy_id actor_legacy_id,day.id departure_day_id,day.template_day_id,
  item.id activity_item_id,activity.id activity_id
  FROM travel.party_memberships membership
  JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
  JOIN ops.legacy_id_map mapping ON mapping.source_system='public-v2' AND mapping.entity_type='user' AND mapping.target_id=profile.user_id
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
  JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
  JOIN content.activities activity ON activity.agency_id=departure.agency_id AND activity.template_version_id=departure.template_version_id
    AND activity.template_day_id=day.template_day_id AND activity.activity_type='photo_contest' AND activity.status='approved'
  JOIN content.activity_items item ON item.agency_id=activity.agency_id AND item.activity_id=activity.id AND item.item_kind='contest_rule'
  WHERE membership.status='active' ORDER BY day.service_date DESC LIMIT 1`)).rows[0];
if(!fixture)throw new Error("Fixture contest non disponibile");
await client.query("UPDATE travel.departure_days SET service_date=current_date WHERE id=$1",[fixture.departure_day_id]);
const media=[];for(let index=1;index<=3;index++){const id=randomUUID();media.push(id);await client.query(`INSERT INTO ops.media_assets(
  id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES($1,$2,$3,$4,$5,'r2','acceptance', $6,$7,'image/jpeg',128,'contest_entry','party','ready')`,
  [id,fixture.agency_id,fixture.departure_id,fixture.party_id,fixture.user_id,`acceptance/${id}.jpg`,`contest-${index}.jpg`]);}
await client.query("GRANT smf_app TO current_user");await client.query("SET LOCAL ROLE smf_app");
await client.query("SELECT set_config('app.agency_id',$1,true)",[fixture.agency_id]);
const entries=[];for(let index=0;index<2;index++){const row=(await client.query(`SELECT * FROM app.upsert_photo_contest_draft_v3(
  $1,$2,$3,$4,$5,$6,$7,$8,NULL)`,[fixture.actor_legacy_id,fixture.agency_id,fixture.departure_id,fixture.party_id,
  fixture.template_day_id,fixture.activity_item_id,media[index],randomUUID()])).rows[0];if(row.status!=="draft"||Number(row.participant_slot)!==index+1)throw new Error("Bozza contest non valida");entries.push(row.id);}
await client.query("SAVEPOINT third_photo");let thirdDenied=false;try{await client.query(`SELECT * FROM app.upsert_photo_contest_draft_v3(
  $1,$2,$3,$4,$5,$6,$7,$8,NULL)`,[fixture.actor_legacy_id,fixture.agency_id,fixture.departure_id,fixture.party_id,
  fixture.template_day_id,fixture.activity_item_id,media[2],randomUUID()]);}catch(error){thirdDenied=error?.code==="23505";await client.query("ROLLBACK TO SAVEPOINT third_photo");}if(!thirdDenied)throw new Error("La terza foto non e stata rifiutata");
const replaced=(await client.query(`SELECT * FROM app.upsert_photo_contest_draft_v3($1,$2,$3,$4,$5,$6,$7,$8,1::smallint)`,
  [fixture.actor_legacy_id,fixture.agency_id,fixture.departure_id,fixture.party_id,fixture.template_day_id,
  fixture.activity_item_id,media[2],randomUUID()])).rows[0];if(Number(replaced.participant_slot)!==1)throw new Error("Sostituzione slot non riuscita");
const confirmed=(await client.query("SELECT * FROM app.confirm_photo_contest_v3($1,$2,$3,$4,$5)",
  [fixture.actor_legacy_id,fixture.agency_id,fixture.departure_id,fixture.party_id,fixture.activity_item_id])).rows[0];
if(!confirmed||confirmed.entry_ids.length!==2)throw new Error("Conferma delle due foto non riuscita");
await client.query("RESET ROLE");
const evaluations=confirmed.entry_ids.map((id,index)=>({entryId:id,total:index===0?72:88,theme:index===0?35:45,quality:index===0?37:43,reason:`acceptance-${index+1}`}));
const best=(await client.query("SELECT app.complete_photo_contest_evaluation_v3($1,$2::uuid[],'acceptance-model',$3::jsonb) best",
  [fixture.agency_id,confirmed.entry_ids,JSON.stringify(evaluations)])).rows[0]?.best;
if(String(best)!==String(confirmed.entry_ids[1]))throw new Error("Selezione della foto migliore non coerente");
await client.query("UPDATE travel.departure_days SET service_date=current_date-2 WHERE id=$1",[fixture.departure_day_id]);
const closed=Number((await client.query("SELECT app.close_due_photo_contests_v3() closed")).rows[0]?.closed??0);
const ranked=(await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='ranked' AND is_winner)::int winners
  FROM journey.photo_contest_entries WHERE id=ANY($1::uuid[])`,[confirmed.entry_ids])).rows[0];
if(closed<1||ranked.total!==2||ranked.winners!==1)throw new Error(`Chiusura contest non coerente: ${JSON.stringify({closed,ranked})}`);
await client.query("ROLLBACK");open=false;console.log(JSON.stringify({status:"passed_with_rollback",drafts:2,thirdDenied,replaced:true,confirmed:true,bestSelected:true,closed:true,winners:ranked.winners},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}finally{await client.end().catch(()=>{});}
