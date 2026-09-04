import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyDepartureDayDocumentAudience } from "@/lib/platform/programme-documents";
import { MAX_TICKET_SIZE_BYTES, dayDocumentFileDetails } from "@/lib/platform/travel-documents";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";
import { assertTenantStorageCapacity } from "@/lib/platform/storage-quota";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const limited = await enforceApiRateLimit(
      request,
      { scope: "upload.day-document", limit: 30, windowSeconds: 600 },
      actor.id,
    );
    if (limited) return limited;
    const { id: departureId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const dayId = String(body?.dayId || "");
    const partyId = String(body?.partyId || "");
    const travelerId = String(body?.travelerId || "");
    const audienceScope = String(body?.audienceScope || "group");
    const sizeBytes = Number(body?.sizeBytes);
    const file = dayDocumentFileDetails(body?.originalName, body?.contentType);
    if (!file || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_TICKET_SIZE_BYTES) {
      return NextResponse.json({ error: "Documento non valido o superiore a 25 MB" }, { status: 400 });
    }
    if (!["trip", "group", "traveler"].includes(audienceScope))
      return NextResponse.json({ error: "Destinatari non validi" }, { status: 400 });
    const { agencyId } = await requireAgencyDepartureDayDocumentAudience({
      departureId,
      dayId,
      actorId: actor.id,
      partyId: audienceScope === "trip" ? null : partyId,
      travelerId: audienceScope === "traveler" ? travelerId : null,
    });
    await assertTenantStorageCapacity(agencyId, sizeBytes, "document");
    const audienceKey =
      audienceScope === "trip" ? "trip" : audienceScope === "group" ? `groups/${partyId}` : `travelers/${travelerId}`;
    const key = `agencies/${agencyId}/departures/${departureId}/${audienceKey}/days/${dayId}/documents/${crypto.randomUUID()}.${file.extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, file.contentType, 10 * 60));
  } catch (error) {
    return platformApiError(error, "Preparazione del documento non riuscita");
  }
}
