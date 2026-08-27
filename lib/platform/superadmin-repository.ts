import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { readV3AgencyRegistry, readV3ImpersonationUsers, readV3SuperadminSummary } from "./v3-superadmin-read";
import { createV3PlatformAgency, provisionV3PlatformAgencyAgent, updateV3PlatformAgencyBranding } from "./v3-superadmin-mutations";

export type SuperadminSummary = {
  agencies: number;
  trips: number;
  travelers: number;
};

export type AgencyAgent = {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: string;
};

export type AgencyRegistryItem = {
  id: string;
  slug: string;
  name: string;
  status: string;
  legalName: string;
  vatNumber: string;
  taxCode: string;
  registeredAddress: string;
  registeredCity: string;
  registeredPostalCode: string;
  registeredProvince: string;
  registeredCountry: string;
  pec: string;
  sdiCode: string;
  phone: string;
  email: string;
  website: string;
  referenceName: string;
  referenceEmail: string;
  referencePhone: string;
  primaryColor: string;
  logoUrl: string;
  tripCount: number;
  travelerCount: number;
  agents: AgencyAgent[];
};

export type ImpersonationUser = {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  status: string;
  platformRole: "superadmin" | "user";
  agencyNames: string[];
  agencyRoles: string[];
  isTraveler: boolean;
};

function agencySlug(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "agenzia";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function getSuperadminSummary(actorId: string): Promise<SuperadminSummary> {
  return readV3SuperadminSummary(actorId);
}

export async function getAgencyRegistry(actorId: string): Promise<AgencyRegistryItem[]> {
  return readV3AgencyRegistry(actorId);
}

export async function getImpersonationUsers(actorId: string): Promise<ImpersonationUser[]> {
  return readV3ImpersonationUsers(actorId);
}

export async function createAgency(input: {
  actorId: string;
  name: string;
  legalName?: string;
  vatNumber?: string;
  taxCode?: string;
  registeredAddress?: string;
  registeredCity?: string;
  registeredPostalCode?: string;
  registeredProvince?: string;
  registeredCountry?: string;
  pec?: string;
  sdiCode?: string;
  phone?: string;
  email?: string;
  website?: string;
  referenceName: string;
  referenceEmail: string;
  referencePhone: string;
  primaryColor?: string;
  logoUrl?: string;
}) {
  return createV3PlatformAgency({ ...input, slug: agencySlug(input.name) });
}

export async function updateAgencyBranding(input: {
  actorId: string;
  agencyId: string;
  primaryColor: string;
  logoUrl: string;
}) {
  await updateV3PlatformAgencyBranding(input);
}

export async function getAgencyDeletionTarget(agencyId: string) {
  const sql = getSql();
  const agencies = await sql`
    SELECT id::text, name
    FROM agencies
    WHERE id = ${agencyId}
    LIMIT 1
  `;
  if (!agencies[0]) throw new PlatformRequestError("Agenzia non trovata");

  const [assets, users] = await Promise.all([
    sql`
      SELECT id::text, provider, bucket, object_key
      FROM media_assets
      WHERE agency_id = ${agencyId}
      ORDER BY created_at
    `,
    sql`
      SELECT DISTINCT user_id
      FROM (
        SELECT user_id FROM agency_memberships WHERE agency_id = ${agencyId}
        UNION
        SELECT user_id FROM traveler_profiles
        WHERE agency_id = ${agencyId} AND user_id IS NOT NULL
      ) candidates
    `,
  ]);

  return {
    id: String(agencies[0].id),
    name: String(agencies[0].name),
    assets: assets.map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      bucket: String(row.bucket),
      objectKey: String(row.object_key),
    })),
    candidateUserIds: users.map((row) => String(row.user_id)),
  };
}

export async function deleteAgencyRecords(input: {
  agencyId: string;
  candidateUserIds: string[];
}) {
  const sql = getSql();
  const candidateUserIds = input.candidateUserIds.length > 0
    ? input.candidateUserIds
    : [`deleted-agency:${crypto.randomUUID()}`];
  const results = await sql.transaction((transaction) => [
    transaction`DELETE FROM departures WHERE agency_id = ${input.agencyId}`,
    transaction`
      DELETE FROM agencies
      WHERE id = ${input.agencyId}
      RETURNING id
    `,
    transaction`
      DELETE FROM platform_users users
      WHERE users.id = ANY(${candidateUserIds}::text[])
        AND users.platform_role <> 'superadmin'
        AND NOT EXISTS (
          SELECT 1 FROM agency_memberships memberships WHERE memberships.user_id = users.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM traveler_profiles travelers WHERE travelers.user_id = users.id
        )
      RETURNING id
    `,
  ]);
  if (results[1].length !== 1) throw new PlatformRequestError("Eliminazione dell’agenzia non riuscita");
  return { deletedUsers: results[2].length };
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "").join("");
}

export async function createAgencyAgent(input: {
  actorId: string;
  agencyId: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "editor" | "viewer";
}) {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  return provisionV3PlatformAgencyAgent({
    ...input,email:normalizedEmail,initials:initialsFor(input.name),
  });
}
