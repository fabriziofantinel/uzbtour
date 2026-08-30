import { NextRequest, NextResponse } from "next/server";
import { AUTH_ID_COOKIE, AUTH_REFRESH_COOKIE, getAuthProvider } from "./lib/auth/auth-provider";

export async function proxy(request: NextRequest) {
  const auth = getAuthProvider();
  if (auth.isConfigured() && request.cookies.has(AUTH_ID_COOKIE)) return NextResponse.next();
  if (auth.isConfigured()) {
    const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
    if (refreshToken) {
      try {
        const result = await auth.refresh(refreshToken);
        const response = NextResponse.redirect(request.nextUrl);
        auth.setCookies(response, { ...result, RefreshToken: refreshToken });
        return response;
      } catch {
        const response = NextResponse.redirect(new URL("/login", request.url));
        response.cookies.set(AUTH_REFRESH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
        return response;
      }
    }
  }
  const loginUrl = new URL("/login", request.url);
  if (!auth.isConfigured()) loginUrl.searchParams.set("configuration", "missing");
  else loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api|login|auth|attiva-account|accessibilita|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  ]
};
