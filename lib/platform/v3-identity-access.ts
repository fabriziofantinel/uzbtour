import "server-only";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export async function resolveV3CognitoAuthenticatedUser(subject: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT native_user_id,legacy_user_id,display_name,username,email,platform_role,is_agency_admin
    FROM app.resolve_cognito_authenticated_user(${subject})
  `;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: String(row.legacy_user_id),
    nativeId: String(row.native_user_id),
    name: String(row.display_name),
    username: String(row.username),
    email: String(row.email),
    isSuperAdmin: String(row.platform_role) === "superadmin",
    isAgencyAdmin: Boolean(row.is_agency_admin),
  };
}

export async function resolveV3UserAccess(userId: string, agencyId?: string | null) {
  const sql = getSql();
  const rows = await sql`
    SELECT is_active,is_superadmin,is_agency_admin,agency_role
    FROM app.resolve_user_access_v3(${userId}::uuid,${agencyId ?? null}::uuid)
  `;
  const row = rows[0] as Row | undefined;
  return {
    isActive: Boolean(row?.is_active),
    isSuperAdmin: Boolean(row?.is_superadmin),
    isAgencyAdmin: Boolean(row?.is_agency_admin),
    agencyRole: row?.agency_role ? String(row.agency_role) : null,
  };
}

export async function startV3Impersonation(input: {
  actorId: string;
  targetId: string;
  tokenHash: string;
  expiresAt: string;
  userAgent?: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT target_user_id::text,target_legacy_user_id,display_name,email,platform_role,is_agency_admin
    FROM app.start_impersonation_v3(
      ${input.actorId}::uuid,${input.targetId}::uuid,${input.tokenHash},${input.expiresAt}::timestamptz,
      ${input.userAgent?.slice(0, 500) ?? ""}
    )
  `;
  const row = rows[0] as Row | undefined;
  if (!row) throw new Error("Utente non disponibile");
  return {
    id: String(row.target_legacy_user_id),
    nativeId: String(row.target_user_id),
    name: String(row.display_name),
    email: String(row.email),
    isSuperAdmin: String(row.platform_role) === "superadmin",
    isAgencyAdmin: Boolean(row.is_agency_admin),
  };
}

export async function readV3AgencyImpersonationTravelers(actorId: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM app.read_agency_impersonation_travelers(${actorId}::uuid)`;
  return rows.map((row) => ({
    id: String(row.user_id),
    name: String(row.display_name),
    username: String(row.username),
    email: String(row.email),
    status: String(row.user_status),
    agencyId: String(row.agency_id),
    agencyName: String(row.agency_name),
    userKind: String(row.user_kind) as "traveler" | "accompagnatore" | "guida",
    departureTitles: Array.isArray(row.departure_titles) ? row.departure_titles.map(String) : [],
  }));
}

export async function startV3AgencyTravelerImpersonation(input: {
  actorId: string;
  targetId: string;
  tokenHash: string;
  expiresAt: string;
  userAgent?: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT target_user_id::text,target_legacy_user_id,display_name,email,platform_role,is_agency_admin,target_kind
    FROM app.start_agency_traveler_impersonation(
      ${input.actorId}::uuid,${input.targetId}::uuid,${input.tokenHash},${input.expiresAt}::timestamptz,
      ${input.userAgent?.slice(0, 500) ?? ""}
    )
  `;
  if (!rows[0]) throw new Error("Utente non disponibile");
  return {
    id: String(rows[0].target_legacy_user_id),
    userKind: String(rows[0].target_kind) as "traveler" | "accompagnatore" | "guida",
  };
}

export async function resolveV3Impersonation(actorUserId: string, tokenHash: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT target_user_id::text,target_legacy_user_id,display_name,email,platform_role,
      is_agency_admin,expires_at::text
    FROM app.resolve_impersonation_v3(${actorUserId}::uuid,${tokenHash})
  `;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: String(row.target_legacy_user_id),
    nativeId: String(row.target_user_id),
    name: String(row.display_name),
    email: String(row.email),
    isSuperAdmin: String(row.platform_role) === "superadmin",
    isAgencyAdmin: Boolean(row.is_agency_admin),
    expiresAt: String(row.expires_at),
  };
}

export async function endV3Impersonation(actorId: string, tokenHash: string) {
  const sql = getSql();
  await sql`SELECT app.end_impersonation_v3(${actorId}::uuid,${tokenHash})`;
}
