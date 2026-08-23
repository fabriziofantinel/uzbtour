import { getNeonAuth, isNeonAuthConfigured } from "./auth/server";
import { getSql } from "./db";

export type CurrentUser = {
  id: string;
  name: string;
  initials: string;
  email: string;
  isSuperAdmin: boolean;
  isAgencyAdmin: boolean;
};

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "")
    .join("");
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
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
  const permissions = await sql`
    SELECT EXISTS (
      SELECT 1 FROM agency_memberships
      WHERE user_id = ${platformUserId} AND role IN ('owner', 'admin')
    ) AS is_agency_admin
  `;

  return {
    id: platformUserId,
    name: String(platformUser.display_name),
    initials: String(platformUser.initials),
    email,
    isSuperAdmin: String(platformUser.platform_role) === "superadmin",
    isAgencyAdmin: Boolean(permissions[0]?.is_agency_admin)
  };
}
