import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function GET() {
  const cookieStore = await cookies();
  const user = await verifySessionToken(
    cookieStore.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET
  );

  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json({ user });
}
