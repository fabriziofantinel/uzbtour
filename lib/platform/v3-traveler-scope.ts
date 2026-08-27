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
  const sql = getSql();
  const rows = await sql`
    SELECT app.resolve_legacy_traveler_scope(
      ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,
      ${input.dayId ?? null}::uuid
    )::text AS agency_id
  `;
  return rows[0]?.agency_id ? String(rows[0].agency_id) : null;
}
