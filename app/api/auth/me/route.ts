import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { getTripUsers, publicTripUser } from "@/lib/trip-users";

export async function GET() {
  const cookieStore = await cookies();
  const user = await verifySessionToken(
    cookieStore.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET
  );

  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const configuredUser = getTripUsers().find((candidate) => candidate.id === user.id);
  if (!configuredUser) {
    return NextResponse.json({ error: "Profilo non disponibile" }, { status: 401 });
  }

  return NextResponse.json({ user: publicTripUser(configuredUser) });
}
