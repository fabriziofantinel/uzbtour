import "server-only";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3TravelerScopeCutoverReadEnabled() {
  return process.env.V3_TRAVELER_SCOPE_READ_SOURCE !== "legacy";
}

export async function readV3TravelerJourneys(actorUserId: string) {
  const sql = getSql();
  return (await sql`
    SELECT *
    FROM app.list_user_journeys_v3(${actorUserId}::uuid)
  `) as Row[];
}

export async function readV3TravelerDestinationProfile(userId: string, departureId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT currency_code,time_zone,profile_version
    FROM app.read_traveler_destination_profile_v3(${userId}::uuid,${departureId}::uuid)
  `;
  return rows[0] as Row | undefined;
}

export async function resolveV3TravelerScope(input: {
  actorUserId: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
}) {
  const context = await resolveV3TravelerContext(input);
  return context?.agencyId ?? null;
}

export async function resolveV3TravelerContext(input: {
  actorUserId: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT context.agency_id::text,context.template_version_id::text,
      context.traveler_id::text
    FROM app.resolve_traveler_context_v3(
      ${input.actorUserId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid,${input.dayId ?? null}::uuid
    ) context
  `;
  if (!rows[0]) return null;
  return {
    agencyId: String(rows[0].agency_id),
    templateVersionId: String(rows[0].template_version_id),
    travelerId: String(rows[0].traveler_id),
  };
}
