import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { codesMatch, createSessionToken, SESSION_COOKIE, SESSION_DURATION_SECONDS } from "@/lib/session";

export async function POST(request: Request) {
  const accessCode = process.env.TRIP_ACCESS_CODE;
  const authSecret = process.env.AUTH_SECRET;

  if (!accessCode || !authSecret) {
    return NextResponse.json(
      { error: "Accesso non ancora configurato. Contatta l’amministratore del viaggio." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim() ?? "";
  if (!code || !(await codesMatch(code, accessCode))) {
    return NextResponse.json({ error: "Il codice inserito non è corretto." }, { status: 401 });
  }

  const token = await createSessionToken(authSecret);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS
  });
  return NextResponse.json({ ok: true });
}
