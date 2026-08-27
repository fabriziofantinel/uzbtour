import { Client } from "@neondatabase/serverless";

const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!ownerUrl) throw new Error("Connessione diretta Neon owner non configurata");
if (!runtimeUrl) throw new Error("Connessione Neon smf_app non configurata");

const owner = new Client(ownerUrl);
const runtime = new Client(runtimeUrl);
try {
  await owner.connect();
  const fixture = (await owner.query(`
    SELECT mapping.legacy_id actor_legacy_id
    FROM iam.agency_memberships membership
    JOIN iam.users actor ON actor.id=membership.user_id AND actor.status='active'
    JOIN ops.legacy_id_map mapping ON mapping.source_system='public-v2'
      AND mapping.entity_type='user' AND mapping.target_id=actor.id
    WHERE membership.status='active' AND membership.role IN('owner','admin','editor')
    ORDER BY membership.created_at LIMIT 1
  `)).rows[0];
  if (!fixture) throw new Error("Utente agenzia V3 di collaudo non disponibile");

  await runtime.connect();
  const role = (await runtime.query("SELECT current_user role_name")).rows[0]?.role_name;
  if (role !== "smf_app") throw new Error(`Ruolo runtime inatteso: ${role ?? "assente"}`);

  const calls = [
    ["overview", "app.read_agency_overview_v3"],
    ["imports", "app.read_agency_recent_imports_v3"],
    ["contents", "app.read_agency_reference_contents_v3"],
    ["jobs", "app.read_agency_enrichment_jobs_v3"],
    ["companions", "app.read_travel_companions_v3"],
  ];
  const counts = {};
  for (const [label, routine] of calls) {
    const result = await runtime.query(`SELECT * FROM ${routine}($1)`,[fixture.actor_legacy_id]);
    counts[label] = result.rowCount ?? result.rows.length;
  }
  if (counts.overview < 1) throw new Error("La dashboard V3 non restituisce l'agenzia del collaudo");

  console.log(JSON.stringify({status:"passed",runtimeRole:role,counts},null,2));
} finally {
  await runtime.end().catch(()=>{});
  await owner.end().catch(()=>{});
}
