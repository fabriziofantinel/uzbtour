import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const explicitRuntimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const runtimeUrl = explicitRuntimeUrl ?? ownerUrl;
if (!runtimeUrl) throw new Error("Connessione runtime non configurata");
const client = new Client(runtimeUrl);
const owner = ownerUrl ? new Client(ownerUrl) : null;
try {
  await client.connect();
  if (!explicitRuntimeUrl) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET ROLE smf_app");
  }
  if (!owner) throw new Error("Connessione owner necessaria per preparare la fixture viaggiatore");
  await owner.connect();
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const candidate = (
    await owner.query(`SELECT profile.user_id,party.departure_id,party.id party_id,day.id day_id,
    profile.id traveler_id,departure.agency_id,departure.template_version_id
    FROM public.traveler_profiles profile
    JOIN public.party_memberships membership ON membership.traveler_id=profile.id AND membership.status='active'
    JOIN public.travel_parties party ON party.id=membership.party_id AND party.agency_id=membership.agency_id
    JOIN public.departures departure ON departure.id=party.departure_id AND departure.agency_id=party.agency_id
    JOIN public.trip_days day ON day.template_version_id=departure.template_version_id AND day.agency_id=departure.agency_id
    WHERE profile.user_id IS NOT NULL LIMIT 1`)
  ).rows[0];
  if (!candidate) throw new Error("Nessun contesto viaggiatore disponibile");
  const context = (
    await client.query("SELECT * FROM app.resolve_legacy_traveler_context($1,$2,$3,$4)", [
      candidate.user_id,
      candidate.departure_id,
      candidate.party_id,
      candidate.day_id,
    ])
  ).rows[0];
  if (
    !context ||
    String(context.agency_id) !== String(candidate.agency_id) ||
    String(context.template_version_id) !== String(candidate.template_version_id) ||
    String(context.traveler_id) !== String(candidate.traveler_id)
  )
    throw new Error("Contesto V3 non riconciliato");
  const invalid = (
    await client.query("SELECT * FROM app.resolve_legacy_traveler_context($1,$2,$3,$4)", [
      candidate.user_id,
      candidate.departure_id,
      candidate.party_id,
      randomUUID(),
    ])
  ).rows;
  if (invalid.length) throw new Error("Una giornata estranea e stata autorizzata");
  if (
    (await client.query("SELECT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') allowed")).rows[0]
      .allowed
  )
    throw new Error("La mappa identita e leggibile dal runtime");
  console.log(
    JSON.stringify(
      { status: "passed", role, contextMatched: true, foreignDayDenied: true, identityMapPrivate: true },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
}
