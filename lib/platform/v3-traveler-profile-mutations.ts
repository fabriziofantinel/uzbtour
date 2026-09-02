import "server-only";
import { getSql } from "@/lib/db";

export async function updateOwnTripCompetition(input: {
  userId: string;
  departureId: string;
  partyId: string;
  enabled: boolean;
}) {
  const rows = await getSql()`SELECT app.update_own_trip_competition_v3(
    ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,${input.enabled}) updated`;
  return Boolean(rows[0]?.updated);
}

export async function transferOwnGroupLeadership(input: {
  userId: string;
  departureId: string;
  partyId: string;
  travelerId: string;
}) {
  const rows = await getSql()`SELECT app.transfer_own_group_leadership_v3(
    ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,${input.travelerId}::uuid) updated`;
  return Boolean(rows[0]?.updated);
}
