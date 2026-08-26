import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertProgrammeFeedbackSchema } from "@/lib/platform/schema-readiness";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  await assertProgrammeFeedbackSchema();
  const { id } = await context.params;
  const sql = getSql();
  const rows = await sql`
    SELECT asset.provider, asset.bucket, asset.object_key, asset.original_name, asset.content_type
    FROM itinerary_item_documents document
    JOIN media_assets asset ON asset.id = document.media_asset_id AND asset.agency_id = document.agency_id
    WHERE document.id = ${id} AND asset.status = 'ready'
      AND (
        EXISTS (
          SELECT 1 FROM agency_memberships membership
          WHERE membership.agency_id = document.agency_id AND membership.user_id = ${user.id}
            AND membership.role IN ('owner', 'admin', 'editor')
        )
        OR EXISTS (
          SELECT 1
          FROM traveler_profiles profile
          JOIN party_memberships membership
            ON membership.traveler_id = profile.id AND membership.agency_id = profile.agency_id
            AND membership.status = 'active'
          JOIN travel_parties party
            ON party.id = membership.party_id AND party.agency_id = membership.agency_id
          WHERE profile.user_id = ${user.id} AND party.departure_id = document.departure_id
        )
      )
    LIMIT 1
  `;
  if (!rows[0]) return NextResponse.json({ error: "Biglietto non trovato" }, { status: 404 });
  const storage = getObjectStorage();
  if (String(rows[0].provider) !== storage.provider || String(rows[0].bucket) !== storage.bucket) {
    return NextResponse.json({ error: "Storage non coerente" }, { status: 409 });
  }
  const filename = String(rows[0].original_name).replace(/["\r\n]/g, "");
  const url = await storage.createDownloadUrl(String(rows[0].object_key), 5 * 60, {
    contentType: String(rows[0].content_type),
    contentDisposition: `attachment; filename="${filename}"`,
  });
  return NextResponse.redirect(url);
}
