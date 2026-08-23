import { getNeonAuth, isNeonAuthConfigured } from "./auth/server";
import { getSql } from "./db";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";

export const IMPERSONATION_COOKIE = "smf_impersonation";

export type CurrentUser = {
  id: string;
  name: string;
  initials: string;
  email: string;
  isSuperAdmin: boolean;
  isAgencyAdmin: boolean;
  impersonation: {
    actorId: string;
    actorName: string;
    expiresAt: string;
  } | null;
};

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "")
    .join("");
}

async function userPermissions(userId: string) {
  const sql = getSql();
  const permissions = await sql`
    SELECT EXISTS (
      SELECT 1 FROM agency_memberships
      WHERE user_id = ${userId} AND role IN ('owner', 'admin')
    ) AS is_agency_admin
  `;
  return Boolean(permissions[0]?.is_agency_admin);
}

export async function getAuthenticatedActor(): Promise<CurrentUser | null> {
  if (!isNeonAuthConfigured()) return null;

  const { data: session, error } = await getNeonAuth().getSession();
  if (error || !session?.user?.id || !session.user.email) return null;

  const authSubject = String(session.user.id);
  const email = String(session.user.email).trim().toLocaleLowerCase("en-US");
  const displayName = String(session.user.name || email.split("@")[0] || "Viaggiatore").trim();
  const sql = getSql();
  const existing = await sql`
    SELECT id, display_name, initials, status, platform_role
    FROM platform_users
    WHERE (auth_provider = 'neon' AND auth_subject = ${authSubject})
       OR LOWER(email) = ${email}
    ORDER BY CASE WHEN auth_provider = 'neon' AND auth_subject = ${authSubject} THEN 0 ELSE 1 END
    LIMIT 1
  `;

  let platformUser = existing[0];
  if (platformUser) {
    if (String(platformUser.status) === "disabled") return null;
    const updated = await sql`
      UPDATE platform_users
      SET auth_provider = 'neon',
          auth_subject = ${authSubject},
          email = ${email},
          display_name = COALESCE(NULLIF(display_name, ''), ${displayName}),
          initials = COALESCE(NULLIF(initials, ''), ${initialsFor(displayName)}),
          status = 'active',
          updated_at = NOW()
      WHERE id = ${String(platformUser.id)}
      RETURNING id, display_name, initials, platform_role
    `;
    platformUser = updated[0];
  } else return null;

  if (!platformUser) return null;
  const platformUserId = String(platformUser.id);

  return {
    id: platformUserId,
    name: String(platformUser.display_name),
    initials: String(platformUser.initials),
    email,
    isSuperAdmin: String(platformUser.platform_role) === "superadmin",
    isAgencyAdmin: await userPermissions(platformUserId),
    impersonation: null
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const actor = await getAuthenticatedActor();
  if (!actor) return null;

  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!token || !actor.isSuperAdmin) return actor;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sql = getSql();
  const rows = await sql`
    SELECT sessions.target_user_id, sessions.expires_at,
           users.display_name, users.initials, users.email,
           users.platform_role, users.status
    FROM impersonation_sessions sessions
    JOIN platform_users users ON users.id = sessions.target_user_id
    WHERE sessions.token_hash = ${tokenHash}
      AND sessions.actor_user_id = ${actor.id}
      AND sessions.ended_at IS NULL
      AND sessions.expires_at > NOW()
    LIMIT 1
  `;
  const target = rows[0];
  if (!target || String(target.status) === "disabled") return actor;

  const targetId = String(target.target_user_id);
  return {
    id: targetId,
    name: String(target.display_name),
    initials: String(target.initials || initialsFor(String(target.display_name))),
    email: String(target.email || ""),
    isSuperAdmin: String(target.platform_role) === "superadmin",
    isAgencyAdmin: await userPermissions(targetId),
    impersonation: {
      actorId: actor.id,
      actorName: actor.name,
      expiresAt: new Date(String(target.expires_at)).toISOString()
    }
  };
}
