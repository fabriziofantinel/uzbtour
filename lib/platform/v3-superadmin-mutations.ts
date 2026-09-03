import "server-only";
import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
  );
}

export async function createV3PlatformAgency(input: Record<string, string> & { actorId: string }) {
  const sql = getSql();
  const branding = JSON.stringify({ primaryColor: input.primaryColor || "#247A6B", logoUrl: input.logoUrl || "" });
  const rows = await sql`SELECT app.create_platform_agency(${input.actorId},${input.slug},${input.name},
    ${input.legalName || ""},${input.vatNumber || ""},${input.taxCode || ""},${input.registeredAddress || ""},
    ${input.registeredCity || ""},${input.registeredPostalCode || ""},${input.registeredProvince || ""},
    ${input.registeredCountry || ""},${input.pec || ""},${input.sdiCode || ""},${input.phone || ""},
    ${input.email || ""},${input.website || ""},${input.referenceName},${input.referenceEmail || ""},
    ${input.referencePhone || ""},${branding}::jsonb)::text id`;
  return String(rows[0].id);
}

export async function createV3PlatformAgencyWithOwner(
  input: Record<string, string> & {
    actorId: string;
    tokenHash: string;
    expiresAt: string;
  },
) {
  const sql = getSql();
  const payload = JSON.stringify({
    ...input,
    branding: { primaryColor: input.primaryColor || "#247A6B", logoUrl: input.logoUrl || "" },
  });
  let rows;
  try {
    rows = await sql`SELECT * FROM app.create_platform_agency_with_owner(
    ${input.actorId},${payload}::jsonb,${input.tokenHash},${input.expiresAt}::timestamptz)`;
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformRequestError("Nome agenzia o username responsabile già presente");
    throw error;
  }
  if (!rows[0]) throw new PlatformRequestError("Agenzia e responsabile non creati");
  return {
    agencyId: String(rows[0].agency_id),
    legacyUserId: String(rows[0].legacy_user_id),
    activationRequired: Boolean(rows[0].activation_required),
  };
}

export async function updateV3PlatformAgencyBranding(input: {
  actorId: string;
  agencyId: string;
  primaryColor: string;
  logoUrl: string;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.update_platform_agency_branding(
    ${input.actorId}::uuid,${input.agencyId}::uuid,${input.primaryColor},${input.logoUrl}) updated`;
  if (!rows[0]?.updated) throw new PlatformRequestError("Agenzia non trovata");
}

export async function updateV3PlatformAgencyStatus(input: {
  actorId: string;
  agencyId: string;
  status: "trial" | "active" | "suspended";
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.update_platform_agency_status(
    ${input.actorId}::uuid,${input.agencyId}::uuid,${input.status}) updated`;
  if (!rows[0]?.updated) throw new PlatformRequestError("Agenzia non trovata o già in cancellazione");
}

export async function replaceV3PlatformAgencyOwner(input: {
  actorId: string;
  agencyId: string;
  name: string;
  initials: string;
  username: string;
  email: string;
  phone: string;
  tokenHash: string;
  expiresAt: string;
}) {
  const sql = getSql();
  let rows;
  try {
    rows = await sql`SELECT * FROM app.replace_platform_agency_owner(
    ${input.actorId},${input.agencyId}::uuid,${input.name},${input.initials},${input.username},
    ${input.email},${input.phone},${input.tokenHash},${input.expiresAt}::timestamptz)`;
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformRequestError("Username già assegnato a un altro account");
    throw error;
  }
  if (!rows[0]) throw new PlatformRequestError("Responsabile non sostituito");
  return { id: String(rows[0].legacy_user_id), activationRequired: Boolean(rows[0].activation_required) };
}

export async function updateV3PlatformAgencyOwnerContact(input: {
  actorId: string;
  agencyId: string;
  email: string;
  phone: string;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.update_platform_agency_owner_contact(
    ${input.actorId}::uuid,${input.agencyId}::uuid,${input.email},${input.phone}) updated`;
  if (!rows[0]?.updated) throw new PlatformRequestError("Responsabile non trovato");
}

export async function readV3UsernameAvailability(actorId: string, username: string) {
  const sql = getSql();
  const rows = await sql`SELECT app.is_username_available(${actorId}::uuid,${username}) available`;
  return Boolean(rows[0]?.available);
}

export async function updateV3PlatformAgencyDetails(input: {
  actorId: string;
  agencyId: string;
  data: Record<string, string>;
}) {
  const sql = getSql();
  const rows =
    await sql`SELECT app.update_platform_agency_details(${input.actorId}::uuid,${input.agencyId}::uuid,${JSON.stringify(input.data)}::jsonb) updated`;
  if (!rows[0]?.updated) throw new PlatformRequestError("Agenzia non trovata");
}

export async function provisionV3PlatformAgencyAgent(input: {
  actorId: string;
  agencyId: string;
  name: string;
  initials: string;
  username: string;
  email: string;
  phone: string;
  role: "admin" | "editor" | "viewer";
  tokenHash: string;
  expiresAt: string;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.provision_platform_agency_agent(
    ${input.actorId},${input.agencyId}::uuid,${input.name},${input.initials},${input.username},
    ${input.email},${input.phone},${input.role},${input.tokenHash},${input.expiresAt}::timestamptz)`;
  return { id: String(rows[0].legacy_user_id), activationRequired: Boolean(rows[0].activation_required) };
}
