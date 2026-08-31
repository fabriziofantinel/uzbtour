import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedActor, IMPERSONATION_COOKIE } from "@/lib/current-user";
import { endImpersonation } from "@/lib/platform/impersonation";
import { AUTH_REFRESH_COOKIE, getAuthProvider } from "@/lib/auth/auth-provider";

async function logout(request: Request) {
  const cookieStore = await cookies();
  const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const actor = impersonationToken ? await getAuthenticatedActor() : null;
  if (impersonationToken && actor && (actor.isSuperAdmin || actor.isAgencyAdmin)) {
    await endImpersonation(actor.id, impersonationToken);
    const response = NextResponse.redirect(new URL(actor.isSuperAdmin ? "/admin" : "/agenzia", request.url), 303);
    response.cookies.set(IMPERSONATION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }
  const auth = getAuthProvider();
  const refreshToken = cookieStore.get(AUTH_REFRESH_COOKIE)?.value;
  if (refreshToken && auth.isConfigured()) await auth.revoke(refreshToken).catch(() => undefined);
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  auth.clearCookies(response);
  response.headers.set("Clear-Site-Data", '"cache", "storage"');
  return response;
}

export const GET = logout;
export const POST = logout;
