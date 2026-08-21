import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import type { AgencyRole, PlatformOverview } from "./types";

type OverviewRow = {
  agency_id: string;
  agency_slug: string;
  agency_name: string;
  agency_status: string;
  agency_role: AgencyRole;
  template_id: string | null;
  template_title: string | null;
  template_status: string | null;
  departure_id: string | null;
  departure_code: string | null;
  departure_title: string | null;
  starts_on: string | null;
  ends_on: string | null;
  departure_status: string | null;
  party_count: string;
};

export async function getPlatformOverview(
  actor: { id: string; name: string }
): Promise<PlatformOverview> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      a.id::text AS agency_id,
      a.slug AS agency_slug,
      a.name AS agency_name,
      a.status AS agency_status,
      am.role AS agency_role,
      tt.id::text AS template_id,
      tt.title AS template_title,
      tt.status AS template_status,
      d.id::text AS departure_id,
      d.code AS departure_code,
      d.title AS departure_title,
      d.starts_on::text AS starts_on,
      d.ends_on::text AS ends_on,
      d.status AS departure_status,
      COUNT(DISTINCT tp.id)::text AS party_count
    FROM agency_memberships am
    JOIN agencies a ON a.id = am.agency_id
    LEFT JOIN trip_templates tt ON tt.agency_id = a.id
    LEFT JOIN departures d ON d.template_id = tt.id AND d.agency_id = a.id
    LEFT JOIN travel_parties tp ON tp.departure_id = d.id AND tp.agency_id = a.id
    WHERE am.user_id = ${actor.id} AND am.role IN ('owner', 'admin')
    GROUP BY a.id, a.slug, a.name, a.status, am.role, tt.id, tt.title, tt.status,
      d.id, d.code, d.title, d.starts_on, d.ends_on, d.status
    ORDER BY a.name, tt.title NULLS LAST, d.starts_on DESC NULLS LAST
  `) as OverviewRow[];

  const agencies = new Map<string, PlatformOverview["agencies"][number]>();
  for (const row of rows) {
    let agency = agencies.get(row.agency_id);
    if (!agency) {
      agency = {
        id: row.agency_id,
        slug: row.agency_slug,
        name: row.agency_name,
        status: row.agency_status,
        role: row.agency_role,
        trips: [],
      };
      agencies.set(row.agency_id, agency);
    }
    if (!row.template_id || !row.template_title || !row.template_status) continue;

    let trip = agency.trips.find((candidate) => candidate.id === row.template_id);
    if (!trip) {
      trip = {
        id: row.template_id,
        title: row.template_title,
        status: row.template_status,
        departures: [],
      };
      agency.trips.push(trip);
    }
    if (
      row.departure_id && row.departure_code && row.departure_title && row.starts_on &&
      row.ends_on && row.departure_status
    ) {
      trip.departures.push({
        id: row.departure_id,
        code: row.departure_code,
        title: row.departure_title,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        status: row.departure_status,
        partyCount: Number(row.party_count),
      });
    }
  }

  return {
    actor: { id: actor.id, name: actor.name },
    providers: getPlatformProviderConfig(),
    agencies: [...agencies.values()],
  };
}
