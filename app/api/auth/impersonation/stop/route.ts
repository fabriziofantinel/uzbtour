import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedActor, IMPERSONATION_COOKIE } from "@/lib/current-user";
import { endImpersonation } from "@/lib/platform/impersonation";

export async function POST(request: Request) {
  const actor = await getAuthenticatedActor();
  if (!actor?.isSuperAdmin) return NextResponse.redirect(new URL("/login", request.url), 303);
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  await endImpersonation(actor.id, token);
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(IMPERSONATION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
