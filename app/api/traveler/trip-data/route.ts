import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getTravelerExperience } from "@/lib/platform/traveler-experience";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const departureId = new URL(request.url).searchParams.get("partenza") || undefined;
  const experience = await getTravelerExperience(user.id, departureId, user.nativeId);
  if (!experience) return NextResponse.json({ error: "Viaggio non disponibile" }, { status: 404 });
  return NextResponse.json(experience, { headers: { "Cache-Control": "private, no-cache", Vary: "Cookie" } });
}
