import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";

export class PlatformAuthorizationError extends Error {
  constructor(message: string, public readonly status: 401 | 403) {
    super(message);
  }
}

export async function requirePlatformAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);

  const sql = getSql();
  const memberships = await sql`
    SELECT 1
    FROM agency_memberships
    WHERE user_id = ${user.id} AND role IN ('owner', 'admin')
    LIMIT 1
  `;
  if (memberships.length === 0) {
    throw new PlatformAuthorizationError("Accesso riservato all'amministratore", 403);
  }
  return user;
}

export async function requireAgencyAdmin(agencyId: string) {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);

  const sql = getSql();
  const memberships = await sql`
    SELECT role
    FROM agency_memberships
    WHERE agency_id = ${agencyId} AND user_id = ${user.id} AND role IN ('owner', 'admin')
    LIMIT 1
  `;
  if (memberships.length === 0) {
    throw new PlatformAuthorizationError("Non puoi amministrare questa agenzia", 403);
  }
  return user;
}
