import "server-only";
import { getSql } from "@/lib/db";

export async function readCountryProfilesForReview(actorId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_country_profiles_for_review_v3(${actorId}::uuid)`;
  return rows.map((row) => ({
    agencyId: String(row.agency_id),
    countryId: String(row.country_id),
    countryName: String(row.country_name),
    iso2: String(row.iso2 || ""),
    status: String(row.status),
    version: Number(row.version),
    profile: row.profile,
    baseProfile: row.base_profile,
    sources: Array.isArray(row.sources) ? row.sources : [],
    validationErrors: Array.isArray(row.validation_errors) ? row.validation_errors.map(String) : [],
    groundedAt: String(row.grounded_at),
    refreshAfter: String(row.refresh_after),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
}

export async function saveCountryProfileOverride(
  actorNativeId: string,
  agencyId: string,
  countryId: string,
  profile: unknown,
) {
  const sql = getSql();
  const rows = await sql`SELECT app.save_country_profile_override_v3(
    ${actorNativeId}::uuid,${agencyId}::uuid,${countryId}::uuid,${JSON.stringify(profile)}::jsonb
  ) AS updated`;
  return Boolean(rows[0]?.updated);
}

export async function reviewCountryProfile(actorId: string, agencyId: string, countryId: string, approve: boolean) {
  const sql = getSql();
  const rows =
    await sql`SELECT app.review_country_profile_v3(${actorId}::uuid,${agencyId}::uuid,${countryId}::uuid,${approve}) AS updated`;
  return Boolean(rows[0]?.updated);
}
