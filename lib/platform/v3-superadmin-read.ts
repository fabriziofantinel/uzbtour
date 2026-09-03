import "server-only";

import { getSql } from "@/lib/db";
import { PlatformAuthorizationError } from "./authorization";

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "")
    .join("");
}

export async function readV3SuperadminSummary(actorId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_superadmin_summary(${actorId})`;
  if (!rows[0]) throw new PlatformAuthorizationError("Accesso riservato al superadmin", 403);
  return {
    agencies: Number(rows[0].agencies),
    trips: Number(rows[0].trips),
    travelers: Number(rows[0].travelers),
  };
}

export async function readV3AgencyRegistry(actorId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_superadmin_agency_registry(${actorId})`;
  const agencyIds = [...new Set(rows.map((row) => String(row.agency_id)))];
  return agencyIds.map((id) => {
    const agencyRows = rows.filter((row) => String(row.agency_id) === id);
    const row = agencyRows[0];
    const branding =
      row.branding && typeof row.branding === "object" && !Array.isArray(row.branding)
        ? (row.branding as Record<string, unknown>)
        : {};
    return {
      id,
      slug: String(row.slug),
      name: String(row.agency_name),
      status: String(row.agency_status),
      legalName: String(row.legal_name),
      vatNumber: String(row.vat_number),
      taxCode: String(row.tax_code),
      registeredAddress: String(row.registered_address),
      registeredCity: String(row.registered_city),
      registeredPostalCode: String(row.registered_postal_code),
      registeredProvince: String(row.registered_province),
      registeredCountry: String(row.registered_country),
      pec: String(row.pec),
      sdiCode: String(row.sdi_code),
      phone: String(row.agency_phone),
      email: String(row.agency_email),
      website: String(row.website),
      referenceName: String(row.reference_name),
      referenceEmail: String(row.reference_email),
      referencePhone: String(row.reference_phone),
      primaryColor: String(branding.primaryColor || "#247A6B"),
      logoUrl: String(branding.logoUrl || ""),
      tripCount: Number(row.trip_count),
      travelerCount: Number(row.traveler_count),
      ongoingTripCount: Number(row.ongoing_trip_count),
      upcomingTripCount: Number(row.upcoming_trip_count),
      agents: agencyRows
        .filter((agent) => agent.agent_id)
        .map((agent) => ({
          id: String(agent.agent_id),
          name: String(agent.agent_name),
          username: String(agent.agent_username || ""),
          initials: initialsFor(String(agent.agent_name)),
          email: String(agent.agent_email),
          phone: String(agent.agent_phone),
          role: String(agent.agent_role) as "owner" | "admin" | "editor" | "viewer",
          status: String(agent.agent_status),
        })),
    };
  });
}

export async function readV3ImpersonationUsers(actorUserId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_superadmin_impersonation_users_v3(${actorUserId}::uuid)`;
  return rows.map((row) => ({
    id: String(row.user_id),
    name: String(row.display_name),
    initials: initialsFor(String(row.display_name)),
    username: String(row.username),
    email: String(row.email),
    phone: String(row.phone),
    status: String(row.user_status),
    platformRole: String(row.platform_role) as "superadmin" | "user",
    agencyNames: Array.isArray(row.agency_names) ? row.agency_names.map(String) : [],
    agencyRoles: Array.isArray(row.agency_roles) ? row.agency_roles.map(String) : [],
    isTraveler: Boolean(row.is_traveler),
  }));
}
