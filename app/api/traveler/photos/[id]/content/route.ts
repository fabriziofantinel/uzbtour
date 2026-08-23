import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await context.params;
  const sql = getSql();
  const rows = await sql`
    SELECT asset.provider, asset.bucket, asset.object_key, asset.original_name, asset.content_type
    FROM party_memories memory
    JOIN media_assets asset ON asset.id = memory.media_asset_id AND asset.agency_id = memory.agency_id
    JOIN traveler_profiles profile ON profile.agency_id = memory.agency_id AND profile.user_id = ${user.id}
    JOIN party_memberships membership ON membership.party_id = memory.party_id
      AND membership.traveler_id = profile.id AND membership.status = 'active'
    WHERE memory.id = ${id} AND asset.status = 'ready'
    LIMIT 1
  `;
  if (!rows[0]) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });
  const storage = getObjectStorage();
  if (String(rows[0].provider) !== storage.provider || String(rows[0].bucket) !== storage.bucket) {
    return NextResponse.json({ error: "Storage non coerente" }, { status: 409 });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";
  const url = await storage.createDownloadUrl(String(rows[0].object_key), 5 * 60, {
    contentType: String(rows[0].content_type),
    contentDisposition: download ? `attachment; filename="${String(rows[0].original_name).replace(/["\r\n]/g, "")}"` : "inline",
  });
  return NextResponse.redirect(url);
}
