import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getNeonAuth, isNeonAuthConfigured } from "@/lib/auth/server";
import { getAuthenticatedActor, IMPERSONATION_COOKIE } from "@/lib/current-user";
import { endImpersonation } from "@/lib/platform/impersonation";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const actor = impersonationToken ? await getAuthenticatedActor() : null;
  if (impersonationToken && actor?.isSuperAdmin) {
    await endImpersonation(actor.id, impersonationToken);
    const response = NextResponse.redirect(new URL("/admin", request.url), 303);
    response.cookies.set(IMPERSONATION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }
  if (isNeonAuthConfigured()) await getNeonAuth().signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
