import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTravelerPartyScope } from "@/lib/platform/traveler-experience";
import { MAX_PHOTO_SIZE_BYTES, photoExtensionForUpload, safeOriginalName } from "@/lib/photos";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const limited = await enforceApiRateLimit(
      request,
      { scope: "upload.traveler-photo", limit: 30, windowSeconds: 600 },
      user.id,
    );
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const departureId = String(body?.departureId || "");
    const partyId = String(body?.partyId || "");
    const dayId = String(body?.dayId || "");
    const originalName = safeOriginalName(body?.originalName);
    const contentType = String(body?.contentType || "").toLowerCase();
    const sizeBytes = Number(body?.sizeBytes);
    const extension = photoExtensionForUpload(originalName, contentType);
    if (!extension || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      return NextResponse.json({ error: "Foto non valida o superiore a 25 MB" }, { status: 400 });
    }
    const agencyId = await assertTravelerPartyScope({ userId: user.id, departureId, partyId, dayId });
    const key = `agencies/${agencyId}/departures/${departureId}/parties/${partyId}/days/${dayId}/memories/${crypto.randomUUID()}.${extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, contentType, 10 * 60));
  } catch (error) {
    console.error("Preparazione foto viaggio non riuscita", error);
    return NextResponse.json({ error: "Archivio foto temporaneamente non disponibile" }, { status: 503 });
  }
}
