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
  const legacyUser = (
    await owner.query(`SELECT profile.user_id
    FROM public.traveler_profiles profile
    JOIN public.party_memberships membership ON membership.traveler_id=profile.id AND membership.status='active'
    WHERE profile.user_id IS NOT NULL LIMIT 1`)
  ).rows[0];
  if (!legacyUser) throw new Error("Nessun viaggiatore attivo disponibile");
  const target = (await client.query("SELECT * FROM app.list_legacy_user_journeys($1)", [legacyUser.user_id])).rows;
  const legacy = (
    await owner.query(
      `SELECT departure.id::text departure_id,party.id::text party_id
    FROM public.traveler_profiles profile
    JOIN public.party_memberships membership ON membership.traveler_id=profile.id AND membership.status='active'
    JOIN public.travel_parties party ON party.id=membership.party_id AND party.agency_id=membership.agency_id
    JOIN public.departures departure ON departure.id=party.departure_id AND departure.agency_id=party.agency_id
    WHERE profile.user_id=$1 AND departure.status NOT IN('cancelled','archived')`,
      [legacyUser.user_id],
    )
  ).rows;
  const legacyKeys = legacy.map((row) => `${row.departure_id}:${row.party_id}`).sort();
  const targetKeys = target.map((row) => `${row.departure_id}:${row.party_id}`).sort();
  if (JSON.stringify(legacyKeys) !== JSON.stringify(targetKeys)) throw new Error("Riconciliazione viaggi fallita");
  const first = target[0];
  if (!first) throw new Error("La proiezione v3 non restituisce viaggi");
  const allowed = (
    await client.query("SELECT app.resolve_legacy_traveler_scope($1,$2,$3,NULL) agency_id", [
      legacyUser.user_id,
      first.departure_id,
      first.party_id,
    ])
  ).rows[0]?.agency_id;
  if (String(allowed) !== String(first.agency_id)) throw new Error("Risoluzione scope valida fallita");
  const denied = (
    await client.query("SELECT app.resolve_legacy_traveler_scope($1,$2,$3,NULL) agency_id", [
      legacyUser.user_id,
      randomUUID(),
      first.party_id,
    ])
  ).rows[0]?.agency_id;
  if (denied != null) throw new Error("Lo scope ha autorizzato una partenza non assegnata");
  const mapReadable = (
    await client.query("SELECT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') allowed")
  ).rows[0].allowed;
  if (mapReadable) throw new Error("La mappa tecnica delle identita e leggibile dal runtime");
  console.log(
    JSON.stringify(
      { status: "passed", role, journeys: target.length, scopeDenied: true, identityMapPrivate: true },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
}
