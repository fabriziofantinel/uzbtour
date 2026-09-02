import { getAuthenticatedActor, getCurrentUser } from "@/lib/current-user";
import { resolveV3LegacyUserAccess } from "./v3-identity-access";

export class PlatformAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
  }
}

export async function requirePlatformAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);

  const access = await resolveV3LegacyUserAccess(user.id);
  if (!access.isAgencyAdmin) {
    throw new PlatformAuthorizationError("Accesso riservato all'amministratore", 403);
  }
  return user;
}

export async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);
  if (!user.isSuperAdmin) {
    throw new PlatformAuthorizationError("Accesso riservato al superadmin", 403);
  }
  return user;
}

export async function requireSuperAdminActor() {
  const user = await getAuthenticatedActor();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);
  if (!user.isSuperAdmin) {
    throw new PlatformAuthorizationError("Accesso riservato al superadmin", 403);
  }
  return user;
}

export async function requireAgencyAdminActor() {
  const user = await getAuthenticatedActor();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);
  const access = await resolveV3LegacyUserAccess(user.id);
  if (!access.isAgencyAdmin) throw new PlatformAuthorizationError("Accesso riservato all'agenzia", 403);
  return user;
}

export async function requireAgencyOwnerActor() {
  const user = await getAuthenticatedActor();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);
  const access = await resolveV3LegacyUserAccess(user.id);
  if (user.isSuperAdmin || !access.isAgencyAdmin || access.agencyRole !== "owner") {
    throw new PlatformAuthorizationError("Accesso riservato al responsabile dell'agenzia", 403);
  }
  return user;
}

export async function requireAgencyAdmin(agencyId: string) {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAuthorizationError("Autenticazione richiesta", 401);

  const access = await resolveV3LegacyUserAccess(user.id, agencyId);
  if (!access.isAgencyAdmin) {
    throw new PlatformAuthorizationError("Non puoi amministrare questa agenzia", 403);
  }
  return user;
}
