import { NextRequest, NextResponse } from "next/server";
import { AUTH_ID_COOKIE, AUTH_REFRESH_COOKIE, getAuthProvider } from "./lib/auth/auth-provider";

export async function proxy(request: NextRequest) {
  const traceId = /^[0-9a-f-]{36}$/i.test(request.headers.get("x-smf-trace-id") || "")
    ? request.headers.get("x-smf-trace-id")!
    : crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-smf-trace-id", traceId);
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
    response.headers.set("x-smf-trace-id", traceId);
    return response;
  }
  const auth = getAuthProvider();
  if (auth.isConfigured() && request.cookies.has(AUTH_ID_COOKIE)) {
    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
    response.headers.set("x-smf-trace-id", traceId);
    return response;
  }
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
        response.cookies.set(AUTH_REFRESH_COOKIE, "", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
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
    "/api/:path*",
    "/((?!login|auth|attiva-account|accessibilita|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
