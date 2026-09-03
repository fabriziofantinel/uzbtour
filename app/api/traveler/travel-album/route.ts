import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getTravelerExperience } from "@/lib/platform/traveler-experience";
import { createTravelAlbumPdf } from "@/lib/platform/travel-album-pdf";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const departureId = new URL(request.url).searchParams.get("partenza") || undefined;
  const experience = await getTravelerExperience(user.id, departureId, user.nativeId);
  if (!experience) return NextResponse.json({ error: "Viaggio non disponibile" }, { status: 404 });
  const pdf = await createTravelAlbumPdf(user.nativeId, experience);
  const sql = getSql();
  await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${experience.journey.agencyId}, true)`,
    txn`INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
      VALUES(${experience.journey.agencyId},${user.nativeId}::uuid,
      'travel_album',${experience.journey.departureId},'download',jsonb_build_object('partyId',${experience.journey.partyId},'photoCount',${experience.photos.length}))`,
  ]);
  const filename = `diario-${experience.journey.title}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename || "viaggio"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
