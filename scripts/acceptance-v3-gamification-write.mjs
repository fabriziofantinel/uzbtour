import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
if (!runtimeUrl) throw new Error("Connessione Neon smf_app non configurata");
const client = new Client(url);
const runtimeClient = new Client(runtimeUrl);
let open = false;
try {
  await client.connect();
  const fixture = (await client.query(`
    SELECT membership.agency_id, membership.departure_id, membership.party_id,
      day.template_day_id, item.id activity_item_id, mapping.legacy_id actor_legacy_id,
      activity.activity_type
    FROM travel.party_memberships membership
    JOIN travel.traveler_profiles profile
      ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
    JOIN ops.legacy_id_map mapping
      ON mapping.source_system='public-v2' AND mapping.entity_type='user'
     AND mapping.target_id=profile.user_id
    JOIN travel.departures departure
      ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
    JOIN travel.departure_days day
      ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
    JOIN content.activities activity
      ON activity.agency_id=departure.agency_id
     AND activity.template_version_id=departure.template_version_id
     AND activity.template_day_id=day.template_day_id
     AND activity.status='approved' AND activity.activity_type<>'photo_contest'
    JOIN content.activity_items item
      ON item.agency_id=activity.agency_id AND item.template_version_id=activity.template_version_id
     AND item.activity_id=activity.id
    WHERE membership.status='active'
    ORDER BY CASE WHEN activity.activity_type='quiz' THEN 1 ELSE 0 END,day.service_date,item.ordinal
    LIMIT 1
  `)).rows[0];
  if (!fixture) throw new Error("Fixture V3 gamification non disponibile");
  await runtimeClient.connect();
  await runtimeClient.query("BEGIN");
  open = true;
  await runtimeClient.query("SELECT set_config('app.agency_id',$1,true)",[fixture.agency_id]);
  const resultId = randomUUID();
  const saved = (await runtimeClient.query(`SELECT * FROM app.save_activity_item_result_v3(
    $1,$2,$3,$4,$5,$6,$7,0,10,'submitted',$8::jsonb,NULL)`,[
      fixture.actor_legacy_id,fixture.agency_id,fixture.departure_id,fixture.party_id,
      fixture.template_day_id,fixture.activity_item_id,resultId,JSON.stringify({ acceptance: true }),
    ])).rows[0];
  if (!saved?.id || saved.status !== "submitted") throw new Error("Salvataggio V3 non verificato");
  await runtimeClient.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: "passed", activityType: fixture.activity_type,
    runtimeRole: "smf_app", rollback: true }, null, 2));
} catch (error) {
  if (open) await runtimeClient.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await runtimeClient.end().catch(() => {});
  await client.end().catch(() => {});
}
