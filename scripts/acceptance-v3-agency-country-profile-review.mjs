import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione Neon owner non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const fixture = (
    await client.query(`
    SELECT owner_map.legacy_id actor_id,membership.agency_id,template.id template_id,profile.country_id
    FROM iam.agency_memberships membership
    JOIN ops.legacy_id_map owner_map ON owner_map.target_id=membership.user_id
      AND owner_map.source_system='public-v2' AND owner_map.entity_type='user'
    JOIN iam.users owner_account ON owner_account.id=membership.user_id AND owner_account.platform_role<>'superadmin'
    JOIN travel.trip_templates template ON template.agency_id=membership.agency_id
    CROSS JOIN LATERAL (SELECT id country_id FROM ref.countries ORDER BY name LIMIT 1) profile
    WHERE membership.status='active' AND membership.role='owner' LIMIT 1
  `)
  ).rows[0];
  if (!fixture) {
    const counts = (
      await client.query(`SELECT
      (SELECT count(*) FROM iam.agency_memberships WHERE role='owner' AND status='active') owners,
      (SELECT count(*) FROM travel.trip_templates) templates,
      (SELECT count(*) FROM ref.country_verified_profiles) profiles,
      (SELECT count(*) FROM ops.legacy_id_map WHERE entity_type='user') mapped_users`)
    ).rows[0];
    throw new Error(`Fixture responsabile/viaggio/profilo Paese non disponibile: ${JSON.stringify(counts)}`);
  }
  await client.query(
    `
    INSERT INTO ref.country_verified_profiles(country_id,status,profile,sources,validation_errors,
      generation_model,grounding_model,verified_at,refresh_after)
    VALUES($1,'verified','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'acceptance','acceptance',clock_timestamp(),clock_timestamp()+interval '30 days')
    ON CONFLICT(country_id) DO NOTHING
  `,
    [fixture.country_id],
  );
  await client.query(
    `
    INSERT INTO travel.template_countries(agency_id,template_id,country_id,sort_order)
    SELECT $1,$2,$3,COALESCE((SELECT max(sort_order)+1 FROM travel.template_countries WHERE template_id=$2),0)::smallint
    ON CONFLICT(template_id,country_id) DO NOTHING
  `,
    [fixture.agency_id, fixture.template_id, fixture.country_id],
  );
  const listed = (await client.query("SELECT * FROM app.read_country_profiles_for_review_v3($1)", [fixture.actor_id]))
    .rows;
  if (
    !listed.some(
      (row) =>
        String(row.agency_id) === String(fixture.agency_id) && String(row.country_id) === String(fixture.country_id),
    )
  ) {
    throw new Error("Il responsabile non vede il Paese della propria agenzia");
  }
  const updated = (
    await client.query("SELECT app.review_country_profile_v3($1,$2,$3,true) updated", [
      fixture.actor_id,
      fixture.agency_id,
      fixture.country_id,
    ])
  ).rows[0]?.updated;
  if (!updated) throw new Error("Approvazione del responsabile non registrata");
  const review = (
    await client.query(
      `
    SELECT status FROM ref.country_profile_agency_reviews
    WHERE agency_id=$1 AND country_id=$2 ORDER BY profile_version DESC LIMIT 1
  `,
      [fixture.agency_id, fixture.country_id],
    )
  ).rows[0];
  if (review?.status !== "approved") throw new Error("Stato approvazione agenzia non valido");
  const superadmin = (
    await client.query(`
    SELECT map.legacy_id FROM ops.legacy_id_map map JOIN iam.users account ON account.id=map.target_id
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND account.platform_role='superadmin' LIMIT 1
  `)
  ).rows[0];
  let superadminDenied = true;
  if (superadmin) {
    await client.query("SAVEPOINT deny_superadmin");
    try {
      await client.query("SELECT app.review_country_profile_v3($1,$2,$3,true)", [
        superadmin.legacy_id,
        fixture.agency_id,
        fixture.country_id,
      ]);
      superadminDenied = false;
    } catch (error) {
      if (error?.code !== "42501") throw error;
      await client.query("ROLLBACK TO SAVEPOINT deny_superadmin");
    }
  }
  if (!superadminDenied) throw new Error("Il superuser può ancora validare il profilo Paese");
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      ownerCanReview: true,
      superadminDenied: true,
      agencyScoped: true,
    }),
  );
} finally {
  if (open) await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
