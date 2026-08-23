import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

export const IMPERSONATION_DURATION_SECONDS = 4 * 60 * 60;

export function hashImpersonationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startImpersonation(input: {
  actorId: string;
  targetId: string;
  userAgent?: string;
}) {
  if (input.actorId === input.targetId) throw new Error("Non puoi impersonare il tuo stesso utente");
  const sql = getSql();
  const targets = await sql`
    SELECT id, status, platform_role
    FROM platform_users
    WHERE id = ${input.targetId}
    LIMIT 1
  `;
  const target = targets[0];
  if (!target || String(target.status) === "disabled") throw new Error("Utente non disponibile");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashImpersonationToken(token);
  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_SECONDS * 1000);
  await sql`
    UPDATE impersonation_sessions
    SET ended_at = NOW()
    WHERE actor_user_id = ${input.actorId} AND ended_at IS NULL
  `;
  await sql`
    INSERT INTO impersonation_sessions (
      actor_user_id, target_user_id, token_hash, expires_at, user_agent
    ) VALUES (
      ${input.actorId}, ${input.targetId}, ${tokenHash}, ${expiresAt.toISOString()},
      ${input.userAgent?.slice(0, 500) || null}
    )
  `;

  const hasAgencyAccess = await sql`
    SELECT EXISTS (
      SELECT 1 FROM agency_memberships
      WHERE user_id = ${input.targetId} AND role IN ('owner', 'admin', 'editor')
    ) AS value
  `;
  const redirectUrl = String(target.platform_role) === "superadmin"
    ? "/admin"
    : Boolean(hasAgencyAccess[0]?.value) ? "/agenzia" : "/";
  return { token, expiresAt, redirectUrl };
}

export async function endImpersonation(actorId: string, token?: string) {
  if (!token) return;
  const sql = getSql();
  await sql`
    UPDATE impersonation_sessions
    SET ended_at = NOW()
    WHERE actor_user_id = ${actorId}
      AND token_hash = ${hashImpersonationToken(token)}
      AND ended_at IS NULL
  `;
}
