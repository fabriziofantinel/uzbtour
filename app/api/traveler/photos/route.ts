import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTravelerPartyScope } from "@/lib/platform/traveler-experience";
import { MAX_PHOTO_SIZE_BYTES, PHOTO_CONTENT_TYPES, safeOriginalName } from "@/lib/photos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const departureId = String(body?.departureId || "");
    const partyId = String(body?.partyId || "");
    const dayId = String(body?.dayId || "");
    const objectKey = String(body?.objectKey || "");
    const agencyId = await assertTravelerPartyScope({ userId: user.id, departureId, partyId, dayId });
    const expectedPrefix = `agencies/${agencyId}/departures/${departureId}/parties/${partyId}/days/${dayId}/memories/`;
    if (!objectKey.startsWith(expectedPrefix)) return NextResponse.json({ error: "Percorso foto non valido" }, { status: 400 });
    const storage = getObjectStorage();
    const metadata = await storage.head(objectKey);
    if (!PHOTO_CONTENT_TYPES.includes(metadata.contentType as typeof PHOTO_CONTENT_TYPES[number]) ||
        metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è una foto valida" }, { status: 400 });
    }
    const sql = getSql();
    const mediaId = crypto.randomUUID();
    const memoryId = crypto.randomUUID();
    const rows = await sql.transaction((txn) => [
      txn`
        INSERT INTO media_assets (id, agency_id, departure_id, party_id, uploaded_by_user_id,
          provider, bucket, object_key, original_name, content_type, size_bytes, purpose, visibility, status)
        VALUES (${mediaId}, ${agencyId}, ${departureId}, ${partyId}, ${user.id}, ${storage.provider},
          ${storage.bucket}, ${objectKey}, ${safeOriginalName(body?.originalName)}, ${metadata.contentType},
          ${metadata.sizeBytes}, 'memory_photo', 'party', 'ready')
      `,
      txn`
        INSERT INTO party_memories (id, agency_id, party_id, trip_day_id, media_asset_id, created_by_user_id)
        VALUES (${memoryId}, ${agencyId}, ${partyId}, ${dayId}, ${mediaId}, ${user.id})
        RETURNING id::text, created_at::text
      `,
    ]);
    return NextResponse.json({ photo: {
      id: memoryId, mediaId, dayId, originalName: safeOriginalName(body?.originalName),
      contentType: metadata.contentType, sizeBytes: metadata.sizeBytes, addedBy: user.name,
      createdAt: String(rows[1][0].created_at), contentUrl: `/api/traveler/photos/${memoryId}/content`,
      downloadUrl: `/api/traveler/photos/${memoryId}/content?download=1`, canDelete: true,
    } });
  } catch (error) {
    console.error("Registrazione foto viaggio non riuscita", error);
    return NextResponse.json({ error: "Foto caricata ma non registrata" }, { status: 503 });
  }
}
