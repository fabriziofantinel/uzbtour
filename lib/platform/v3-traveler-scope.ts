import "server-only";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3TravelerScopeCutoverReadEnabled() {
  return process.env.V3_TRAVELER_SCOPE_READ_SOURCE === "v3";
}

export async function readV3TravelerJourneys(userId: string) {
  const sql = getSql();
  return await sql`
    SELECT *
    FROM app.list_legacy_user_journeys(${userId})
  ` as Row[];
}

export async function resolveV3TravelerScope(input: {
  userId: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
}) {
  const context = await resolveV3TravelerContext(input);
  return context?.agencyId ?? null;
}

export async function resolveV3TravelerContext(input: {
  userId: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT context.agency_id::text,context.template_version_id::text,
      context.traveler_id::text
    FROM app.resolve_legacy_traveler_context(
      ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,${input.dayId ?? null}::uuid
    ) context
  `;
  if (!rows[0]) return null;
  return {
    agencyId: String(rows[0].agency_id),
    templateVersionId: String(rows[0].template_version_id),
    travelerId: String(rows[0].traveler_id),
  };
}
