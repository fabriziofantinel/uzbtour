import "server-only";
import { getSql } from "@/lib/db";

export async function readCountryProfilesForReview(actorId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_country_profiles_for_review_v3(${actorId})`;
  return rows.map((row) => ({
    countryId: String(row.country_id), countryName: String(row.country_name), iso2: String(row.iso2 || ""),
    status: String(row.status), version: Number(row.version), profile: row.profile,
    sources: Array.isArray(row.sources) ? row.sources : [],
    validationErrors: Array.isArray(row.validation_errors) ? row.validation_errors.map(String) : [],
    groundedAt: String(row.grounded_at), refreshAfter: String(row.refresh_after),
  }));
}

export async function reviewCountryProfile(actorId: string, countryId: string, approve: boolean) {
  const sql = getSql();
  const rows = await sql`SELECT app.review_country_profile_v3(${actorId},${countryId},${approve}) AS updated`;
  return Boolean(rows[0]?.updated);
}
