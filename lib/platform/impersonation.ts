import { createHash, randomBytes } from "node:crypto";
import { readMyDepartureStaff } from "./departure-operational-control";
import { endV3Impersonation, startV3AgencyTravelerImpersonation, startV3Impersonation } from "./v3-identity-access";

export const IMPERSONATION_DURATION_SECONDS = 4 * 60 * 60;

export function hashImpersonationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startImpersonation(input: { actorId: string; targetId: string; userAgent?: string }) {
  if (input.actorId === input.targetId) throw new Error("Non puoi impersonare il tuo stesso utente");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashImpersonationToken(token);
  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_SECONDS * 1000);
  const target = await startV3Impersonation({
    actorId: input.actorId,
    targetId: input.targetId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    userAgent: input.userAgent,
  });
  const isDepartureStaff =
    !target.isSuperAdmin && !target.isAgencyAdmin && (await readMyDepartureStaff(target.nativeId)).length > 0;
  const redirectUrl = target.isSuperAdmin
    ? "/admin"
    : target.isAgencyAdmin
      ? "/agenzia"
      : isDepartureStaff
        ? "/tour-leader"
        : "/viaggio";
  return { token, expiresAt, redirectUrl };
}

export async function endImpersonation(actorId: string, token?: string) {
  if (!token) return;
  await endV3Impersonation(actorId, hashImpersonationToken(token));
}

export async function startAgencyTravelerImpersonation(input: {
  actorId: string;
  targetId: string;
  userAgent?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + IMPERSONATION_DURATION_SECONDS * 1000);
  const target = await startV3AgencyTravelerImpersonation({
    ...input,
    tokenHash: hashImpersonationToken(token),
    expiresAt: expiresAt.toISOString(),
  });
  return { token, expiresAt, redirectUrl: target.userKind === "traveler" ? "/viaggio" : "/tour-leader" };
}
