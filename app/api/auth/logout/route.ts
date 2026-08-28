import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedActor, IMPERSONATION_COOKIE } from "@/lib/current-user";
import { endImpersonation } from "@/lib/platform/impersonation";
import { clearCognitoCookies, COGNITO_REFRESH_COOKIE, isCognitoConfigured, revokeCognitoRefreshToken } from "@/lib/auth/cognito";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const actor = impersonationToken ? await getAuthenticatedActor() : null;
  if (impersonationToken && actor && (actor.isSuperAdmin || actor.isAgencyAdmin)) {
    await endImpersonation(actor.id, impersonationToken);
    const response = NextResponse.redirect(new URL(actor.isSuperAdmin ? "/admin" : "/agenzia", request.url), 303);
    response.cookies.set(IMPERSONATION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }
  const refreshToken = cookieStore.get(COGNITO_REFRESH_COOKIE)?.value;
  if (refreshToken && isCognitoConfigured()) await revokeCognitoRefreshToken(refreshToken).catch(() => undefined);
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  clearCognitoCookies(response);
  return response;
}
