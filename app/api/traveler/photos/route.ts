import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTravelerPartyScope } from "@/lib/platform/traveler-experience";
import { isMediaObjectRegistered, registerV3MemoryUpload } from "@/lib/platform/v3-media-mutations";
import { MAX_PHOTO_SIZE_BYTES, PHOTO_CONTENT_TYPES, safeOriginalName } from "@/lib/photos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let uploadedObjectKey = "";
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
    uploadedObjectKey = objectKey;
    const storage = getObjectStorage();
    const metadata = await storage.head(objectKey);
    if (!PHOTO_CONTENT_TYPES.includes(metadata.contentType as typeof PHOTO_CONTENT_TYPES[number]) ||
        metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è una foto valida" }, { status: 400 });
    }
    const mediaId = crypto.randomUUID();
    const memoryId = crypto.randomUUID();
    const originalName = safeOriginalName(body?.originalName);
    const memory = await registerV3MemoryUpload({
      userId: user.id, departureId, partyId, dayId, mediaId, memoryId,
      provider: storage.provider, bucket: storage.bucket, objectKey,
      originalName, contentType: metadata.contentType, sizeBytes: metadata.sizeBytes,
    });
    return NextResponse.json({ photo: {
      id: memory.id, mediaId, dayId, originalName,
      contentType: metadata.contentType, sizeBytes: metadata.sizeBytes, addedBy: user.name,
      createdAt: memory.createdAt, contentUrl: `/api/traveler/photos/${memory.id}/content`,
      downloadUrl: `/api/traveler/photos/${memory.id}/content?download=1`, canDelete: true,
    } });
  } catch (error) {
    if (uploadedObjectKey) {
      const registered = await isMediaObjectRegistered(uploadedObjectKey).catch(() => true);
      if (!registered) await getObjectStorage().delete(uploadedObjectKey).catch(() => undefined);
    }
    console.error("Registrazione foto viaggio non riuscita", error);
    return NextResponse.json({ error: "Foto caricata ma non registrata" }, { status: 503 });
  }
}
