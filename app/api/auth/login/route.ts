import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSql } from "@/lib/db";
import { codesMatch, createSessionToken, SESSION_COOKIE, SESSION_DURATION_SECONDS } from "@/lib/session";
import { getTripUsers, publicTripUser } from "@/lib/trip-users";

export async function POST(request: Request) {
  const authSecret = process.env.AUTH_SECRET;
  const users = getTripUsers();

  if (!users.length || !authSecret) {
    return NextResponse.json(
      { error: "Accesso non ancora configurato. Contatta l’amministratore del viaggio." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as { userId?: string; code?: string } | null;
  const selectedUser = users.find((user) => user.id === body?.userId);
  const code = body?.code?.trim() ?? "";
  if (!selectedUser || !code || !(await codesMatch(code, selectedUser.code))) {
    return NextResponse.json({ error: "Il codice inserito non è corretto." }, { status: 401 });
  }

  const user = publicTripUser(selectedUser);
  const sql = getSql();
  const memberships = await sql`
    SELECT 1
    FROM agency_memberships
    WHERE user_id = ${user.id} AND role IN ('owner', 'admin')
    LIMIT 1
  `;
  const destination = memberships.length > 0 ? "/agenzia" : "/";
  const token = await createSessionToken(authSecret, user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS
  });
  return NextResponse.json({ ok: true, user, destination });
}
