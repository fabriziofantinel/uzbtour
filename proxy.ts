import { NextRequest, NextResponse } from "next/server";
import { getNeonAuth, isNeonAuthConfigured } from "./lib/auth/server";

export async function proxy(request: NextRequest) {
  if (!isNeonAuthConfigured()) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("configuration", "missing");
    return NextResponse.redirect(loginUrl);
  }
  return getNeonAuth().middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: [
    "/((?!api/auth|login|auth|attiva-account|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  ]
};
