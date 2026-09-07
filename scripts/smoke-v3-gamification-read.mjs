import { randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!runtimeUrl) throw new Error("Connessione Neon non configurata");
const client = new Client(runtimeUrl);
let open = false;
try {
  await client.connect();
  const usingOwnerFallback = !process.env.DATABASE_URL;
  const role = "smf_app";
  const required = [
    "content.activities",
    "content.activity_items",
    "ops.media_assets",
    "journey.memories",
    "journey.activity_attempts",
    "journey.activity_evidence",
    "journey.photo_contest_entries",
    "journey.photo_contest_judgements",
  ];
  const missing = (
    await client.query(
      `SELECT table_name,has_table_privilege('smf_app',table_name,'SELECT') allowed
    FROM unnest($1::text[]) table_name`,
      [required],
    )
  ).rows
    .filter((row) => row.allowed !== true)
    .map((row) => row.table_name);
  if (missing.length) throw new Error(`Ruolo runtime ${role} senza SELECT su: ${missing.join(", ")}`);
  if (
    (await client.query("SELECT has_table_privilege('smf_app','ops.legacy_generated_content_map','SELECT') allowed"))
      .rows[0].allowed
  )
    throw new Error("La mappa tecnica dei contenuti è leggibile dal runtime");

  const scope = (
    await client.query(`SELECT party.agency_id,party.departure_id,party.id party_id,
    departure.template_version_id FROM public.travel_parties party
    JOIN public.departures departure ON departure.id=party.departure_id AND departure.agency_id=party.agency_id
    JOIN travel.departures canonical_departure ON canonical_departure.id=departure.id
      AND canonical_departure.agency_id=departure.agency_id
    JOIN travel.travel_parties canonical_party ON canonical_party.id=party.id
      AND canonical_party.agency_id=party.agency_id
      AND canonical_party.departure_id=party.departure_id
    ORDER BY (SELECT count(*) FROM public.generated_content content
      WHERE content.agency_id=party.agency_id AND content.template_version_id=departure.template_version_id) DESC
    LIMIT 1`)
  ).rows[0];
  if (!scope) throw new Error("Nessuna famiglia disponibile per lo smoke test");

  await client.query("BEGIN");
  open = true;
  if (usingOwnerFallback) await client.query("GRANT smf_app TO current_user");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [scope.agency_id]);
  const reconciliation = (
    await client.query(
      `SELECT domain,legacy_count,target_count FROM (
    SELECT 'challenges' domain,
      (SELECT count(*) FROM public.generated_content WHERE agency_id=$1 AND template_version_id=$4 AND status='approved') legacy_count,
      (SELECT count(*) FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id
        AND activity.agency_id=item.agency_id WHERE activity.agency_id=$1 AND activity.template_version_id=$4
        AND activity.status='approved') target_count
    UNION ALL SELECT 'photos',
      (SELECT count(*) FROM public.party_memories memory JOIN public.media_assets asset ON asset.id=memory.media_asset_id
        WHERE memory.agency_id=$1 AND memory.party_id=$3 AND asset.status='ready'),
      (SELECT count(*) FROM journey.memories memory JOIN ops.media_assets asset ON asset.id=memory.media_asset_id
        WHERE memory.agency_id=$1 AND memory.departure_id=$2 AND memory.party_id=$3 AND asset.status='ready')
    UNION ALL SELECT 'results',
      (SELECT count(*) FROM public.party_activity_results WHERE agency_id=$1 AND party_id=$3),
      (SELECT count(*) FROM journey.activity_attempts attempt CROSS JOIN LATERAL jsonb_each(attempt.answers)
        WHERE attempt.agency_id=$1 AND attempt.departure_id=$2 AND attempt.party_id=$3)
    UNION ALL SELECT 'contests',
      (SELECT count(*) FROM public.party_photo_contest_entries WHERE agency_id=$1 AND party_id=$3),
      (SELECT count(*) FROM journey.photo_contest_entries WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)
    ) counts ORDER BY domain`,
      [scope.agency_id, scope.departure_id, scope.party_id, scope.template_version_id],
    )
  ).rows;
  const mismatches = reconciliation.filter((row) => Number(row.legacy_count) !== Number(row.target_count));
  if (mismatches.length) throw new Error(`Riconciliazione gamification fallita: ${JSON.stringify(mismatches)}`);

  const safety = (
    await client.query(
      `WITH public_projection AS (
    SELECT CASE activity.activity_type
      WHEN 'quiz' THEN jsonb_build_object('question',item.prompt,'options',coalesce(item.payload->'options','[]'::jsonb),
        'explanation',coalesce(item.payload->>'explanation',''))
      WHEN 'photo_contest' THEN jsonb_build_object('description',coalesce(item.payload->>'description',activity.instructions))
      ELSE jsonb_build_object('description',coalesce(item.payload->>'description',''),
        'type',coalesce(item.payload->>'type',''),'instructions',coalesce(item.payload->>'instructions',activity.instructions)) END content
    FROM content.activities activity JOIN content.activity_items item ON item.activity_id=activity.id
      AND item.agency_id=activity.agency_id
    WHERE activity.agency_id=$1 AND activity.template_version_id=$2 AND activity.status='approved'
  ) SELECT
    count(*) FILTER(WHERE content ?| ARRAY['answer','correctIndex','answer_spec']) leak_count,
    (SELECT count(*) FROM content.activity_items item JOIN content.activities activity ON activity.id=item.activity_id
      WHERE activity.agency_id=$1 AND activity.template_version_id=$2 AND activity.activity_type='quiz'
        AND item.answer_spec ? 'correctIndex') quiz_keys_server_side
    FROM public_projection`,
      [scope.agency_id, scope.template_version_id],
    )
  ).rows[0];
  if (Number(safety.leak_count) !== 0)
    throw new Error(`Soluzioni esposte nella proiezione pubblica: ${safety.leak_count}`);

  await client.query("SET LOCAL ROLE smf_app");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [randomUUID()]);
  const crossTenantRows = Number(
    (
      await client.query(`SELECT
    (SELECT count(*) FROM content.activities)+(SELECT count(*) FROM content.activity_items)+
    (SELECT count(*) FROM ops.media_assets)+(SELECT count(*) FROM journey.memories)+
    (SELECT count(*) FROM journey.activity_attempts)+(SELECT count(*) FROM journey.activity_evidence)+
    (SELECT count(*) FROM journey.photo_contest_entries)+(SELECT count(*) FROM journey.photo_contest_judgements) row_count`)
    ).rows[0].row_count,
  );
  if (crossTenantRows !== 0) throw new Error(`Isolamento tenant fallito: ${crossTenantRows} righe visibili`);
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: "passed", role, reconciledDomains: reconciliation.length, safety, crossTenantRows },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
