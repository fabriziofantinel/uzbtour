import "server-only";

import { getSql } from "@/lib/db";

export async function createV3JourneyParty(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  code: string;
  name: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT app.create_journey_party(
      ${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,
      ${input.code},${input.name}
    )::text AS id
  `;
  return String(rows[0].id);
}

export async function provisionV3JourneyTraveler(input: {
  actorId: string;
  agencyId: string;
  partyId: string;
  name: string;
  initials: string;
  username: string;
  email: string;
  phone: string;
  birthDate?: string;
  role: "organizer" | "member";
  tokenHash: string;
  expiresAt: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT traveler_id::text,activation_required
    FROM app.provision_journey_traveler(
      ${input.actorId},${input.agencyId}::uuid,${input.partyId}::uuid,
      ${input.name},${input.initials},${input.username},${input.email},${input.phone},
      ${input.birthDate || null}::date,${input.role},${input.tokenHash},
      ${input.expiresAt}::timestamptz
    )
  `;
  return {
    travelerId: String(rows[0].traveler_id),
    activationRequired: Boolean(rows[0].activation_required),
  };
}
