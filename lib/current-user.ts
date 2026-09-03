import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { resolveV3CognitoAuthenticatedUser, resolveV3Impersonation } from "./platform/v3-identity-access";
import { getAuthProvider } from "./auth/auth-provider";
import { assertCurrentSchema } from "./platform/schema-readiness";
import { readMyTourLeaderDepartures } from "./platform/departure-operational-control";

export const IMPERSONATION_COOKIE = "smf_impersonation";

export type CurrentUser = {
  id: string;
  nativeId: string;
  authSubject: string | null;
  name: string;
  initials: string;
  email: string;
  isSuperAdmin: boolean;
  isAgencyAdmin: boolean;
  isTourLeader: boolean;
  impersonation: {
    actorId: string;
    actorName: string;
    actorIsSuperAdmin: boolean;
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

export async function getAuthenticatedActor(): Promise<CurrentUser | null> {
  await assertCurrentSchema();
  const cognitoIdentity = await getAuthProvider().identity();
  if (cognitoIdentity) {
    const platformUser = await resolveV3CognitoAuthenticatedUser(cognitoIdentity.subject);
    if (!platformUser) return null;
    const isTourLeader = (await readMyTourLeaderDepartures(platformUser.nativeId)).length > 0;
    return {
      id: platformUser.id,
      nativeId: platformUser.nativeId,
      authSubject: cognitoIdentity.subject,
      name: platformUser.name,
      initials: initialsFor(platformUser.name),
      email: platformUser.email,
      isSuperAdmin: platformUser.isSuperAdmin,
      isAgencyAdmin: platformUser.isAgencyAdmin,
      isTourLeader,
      impersonation: null,
    };
  }
  return null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const actor = await getAuthenticatedActor();
  if (!actor) return null;

  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!token || (!actor.isSuperAdmin && !actor.isAgencyAdmin)) return actor;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const target = await resolveV3Impersonation(actor.nativeId, tokenHash);
  if (!target) return actor;
  return {
    id: target.id,
    nativeId: target.nativeId,
    authSubject: null,
    name: target.name,
    initials: initialsFor(target.name),
    email: target.email,
    isSuperAdmin: target.isSuperAdmin,
    isAgencyAdmin: target.isAgencyAdmin,
    isTourLeader: false,
    impersonation: {
      actorId: actor.id,
      actorName: actor.name,
      actorIsSuperAdmin: actor.isSuperAdmin,
      expiresAt: new Date(target.expiresAt).toISOString(),
    },
  };
}
