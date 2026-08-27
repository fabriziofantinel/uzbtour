import crypto from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) throw new Error("DATABASE_URL e DATABASE_OWNER_URL richieste");

const owner = new Client(ownerUrl);
const runtime = new Client(runtimeUrl);
let runtimeTransaction = false;
try {
  await Promise.all([owner.connect(), runtime.connect()]);
  const scope = (await owner.query(`
    SELECT departure.agency_id,departure.id AS departure_id,departure.template_id,
      departure.starts_on,departure.ends_on,actor_map.legacy_id AS actor_id,
      day.id AS day_id,
      coalesce(day.label_override,template_day.metadata->>'legacyLabel','') AS label,
      coalesce(day.title_override,template_day.title) AS title,
      coalesce(day.city_override,template_day.metadata->>'legacyCity','') AS city,
      coalesce(day.description_override,template_day.description) AS description
    FROM travel.departures departure
    JOIN travel.departure_days day ON day.departure_id=departure.id
      AND day.agency_id=departure.agency_id
    JOIN travel.template_days template_day ON template_day.id=day.template_day_id
      AND template_day.agency_id=day.agency_id
    JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
      AND membership.status='active' AND membership.role IN('owner','admin','editor')
    JOIN iam.users actor ON actor.id=membership.user_id AND actor.status='active'
    JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor.id
      AND actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    WHERE departure.status NOT IN('cancelled','archived')
      AND EXISTS(SELECT 1 FROM travel.trip_template_versions version
        WHERE version.agency_id=departure.agency_id AND version.template_id=departure.template_id
          AND version.status='published'
          AND EXISTS(SELECT 1 FROM travel.template_itinerary_items template_item
            WHERE template_item.agency_id=version.agency_id
              AND template_item.template_version_id=version.id))
    ORDER BY departure.created_at,template_day.day_number LIMIT 1
  `)).rows[0];
  if (!scope) throw new Error("Nessun programma operativo disponibile per il test");
  const items = (await owner.query(`
    SELECT item.id::text,item.title,item.description,
      coalesce(to_char(scheduled_start_at AT TIME ZONE departure.timezone,'HH24:MI'),'') AS "startsAt",
      coalesce(to_char(scheduled_end_at AT TIME ZONE departure.timezone,'HH24:MI'),'') AS "endsAt",
      row_number() over(order by item.sort_order,item.id)-1 AS "sortOrder",
      CASE WHEN jsonb_typeof(item.metadata->'includedInQuote')='boolean'
        THEN (item.metadata->>'includedInQuote')::boolean END AS "includedInQuote"
    FROM travel.departure_itinerary_items item
    JOIN travel.departures departure ON departure.id=item.departure_id
      AND departure.agency_id=item.agency_id
    WHERE item.agency_id=$1 AND item.departure_id=$2 AND item.departure_day_id=$3
    ORDER BY item.sort_order,item.id
  `,[scope.agency_id,scope.departure_id,scope.day_id])).rows;
  const stays = (await owner.query(`
    SELECT id::text,name_snapshot AS name,notes,
      row_number() over(order by sort_order,id)-1 AS "sortOrder"
    FROM travel.departure_accommodation_stays
    WHERE agency_id=$1 AND departure_id=$2 AND departure_day_id=$3
      AND operational_status<>'cancelled' ORDER BY sort_order,id
  `,[scope.agency_id,scope.departure_id,scope.day_id])).rows;

  await runtime.query("BEGIN"); runtimeTransaction=true;
  const updated = (await runtime.query(`SELECT app.update_departure_programme_day_v3(
    $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) AS ok`,[
    scope.actor_id,scope.departure_id,scope.day_id,scope.label,scope.title,scope.city,
    scope.description,JSON.stringify(items),JSON.stringify(stays),
  ])).rows[0]?.ok;
  if (!updated) throw new Error("Aggiornamento atomico della giornata non riuscito");

  const newDepartureId=crypto.randomUUID();
  await runtime.query(`SELECT app.create_departure_from_programme_v3(
    $1,$2,$3,$4,$5,$6,$7)`,[
    scope.actor_id,scope.template_id,newDepartureId,`ACCEPT-${crypto.randomUUID().slice(0,8)}`,
    "Partenza acceptance",scope.starts_on,scope.ends_on,
  ]);
  await runtime.query("SELECT set_config('app.agency_id',$1,true)",[scope.agency_id]);
  const materialized=(await runtime.query(`SELECT
    (SELECT count(*)::int FROM travel.departure_days WHERE departure_id=$1) AS days,
    (SELECT count(*)::int FROM travel.departure_itinerary_items WHERE departure_id=$1) AS items,
    (SELECT count(*)::int FROM travel.departure_accommodation_stays WHERE departure_id=$1) AS stays`,
    [newDepartureId])).rows[0];
  if (Number(materialized?.days??0)<1 || Number(materialized?.items??0)<1) {
    throw new Error(`Materializzazione della nuova partenza incompleta: ${JSON.stringify(materialized)}`);
  }

  const job=(await runtime.query(`SELECT id FROM app.enqueue_platform_job_v3(
    $1,$2,'travel-reference.enrich','database',$3::jsonb,$4,clock_timestamp())`,[
    scope.actor_id,scope.agency_id,JSON.stringify({templateId:String(scope.template_id)}),
    `acceptance:${crypto.randomUUID()}`,
  ])).rows[0];
  if (!job?.id) throw new Error("Accodamento ops non riuscito");
  const claimed=(await runtime.query(`SELECT app.claim_platform_job_v3($1,$2,
    'travel-reference.enrich') AS ok`,[job.id,scope.agency_id])).rows[0]?.ok;
  if (!claimed) throw new Error("Claim ops non riuscito");
  const references=(await runtime.query(`SELECT count(*)::int AS count
    FROM app.read_trip_reference_content_v3($1,$2,$3)`,
    [job.id,scope.agency_id,scope.template_id])).rows[0]?.count;
  await runtime.query(`SELECT * FROM app.replace_trip_experience_v3(
    $1,$2,$3,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    [job.id,scope.agency_id,scope.template_id]);
  await runtime.query("ROLLBACK"); runtimeTransaction=false;
  console.log(JSON.stringify({status:"passed",updated:true,materialized,references:Number(references??0)}));
} catch(error) {
  if (runtimeTransaction) await runtime.query("ROLLBACK").catch(()=>{});
  throw error;
} finally {
  await Promise.all([owner.end().catch(()=>{}),runtime.end().catch(()=>{})]);
}
