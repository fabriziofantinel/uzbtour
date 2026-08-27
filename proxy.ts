import { NextRequest, NextResponse } from "next/server";
import { COGNITO_ID_COOKIE, COGNITO_REFRESH_COOKIE, isCognitoConfigured, refreshCognitoTokens, setCognitoCookies } from "./lib/auth/cognito";

export async function proxy(request: NextRequest) {
  if (isCognitoConfigured() && request.cookies.has(COGNITO_ID_COOKIE)) return NextResponse.next();
  if (isCognitoConfigured()) {
    const refreshToken = request.cookies.get(COGNITO_REFRESH_COOKIE)?.value;
    if (refreshToken) {
      try {
        const result = await refreshCognitoTokens(refreshToken);
        const response = NextResponse.redirect(request.nextUrl);
        setCognitoCookies(response, { ...result, RefreshToken: refreshToken });
        return response;
      } catch {
        const response = NextResponse.redirect(new URL("/login", request.url));
        response.cookies.set(COGNITO_REFRESH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
        return response;
      }
    }
  }
  const loginUrl = new URL("/login", request.url);
  if (!isCognitoConfigured()) loginUrl.searchParams.set("configuration", "missing");
  else loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api/auth|login|auth|attiva-account|accessibilita|_next/static|_next/image|favicon.ico|.*\\..*).*)"
  ]
};
