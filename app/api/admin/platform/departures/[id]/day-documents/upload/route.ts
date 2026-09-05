import { NextResponse } from "next/server";
import { z } from "zod";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import { requireDepartureOperator } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyDepartureDayDocumentAudience } from "@/lib/platform/programme-documents";
import { MAX_TICKET_SIZE_BYTES, dayDocumentFileDetails } from "@/lib/platform/travel-documents";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";
import { assertTenantStorageCapacity } from "@/lib/platform/storage-quota";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: departureId } = await context.params;
    const actor = await requireDepartureOperator(departureId);
    const limited = await enforceApiRateLimit(
      request,
      { scope: "upload.day-document", limit: 30, windowSeconds: 600 },
      actor.id,
    );
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const dayId = String(body?.dayId || "");
    const partyId = String(body?.partyId || "");
    const travelerId = String(body?.travelerId || "");
    const audienceScope = String(body?.audienceScope || "group");
    if (["accompagnatore", "guida"].includes(audienceScope)) {
      const recipients = z.array(z.string().uuid()).min(1).max(100).safeParse(body?.staffUserIds);
      if (!recipients.success) return NextResponse.json({ error: "Seleziona almeno un destinatario" }, { status: 400 });
      const { staff } = await readDepartureOperationalControl(actor.nativeId, departureId);
      if (
        recipients.data.some(
          (id) =>
            !staff.some(
              (person) =>
                person.userId === id &&
                person.status === "active" &&
                (person.role === audienceScope ||
                  (audienceScope === "accompagnatore" && person.role === "tour_leader")),
            ),
        )
      )
        return NextResponse.json({ error: "Destinatario non associato al viaggio" }, { status: 400 });
    }
    const sizeBytes = Number(body?.sizeBytes);
    const file = dayDocumentFileDetails(body?.originalName, body?.contentType);
    if (!file || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_TICKET_SIZE_BYTES) {
      return NextResponse.json({ error: "Documento non valido o superiore a 25 MB" }, { status: 400 });
    }
    if (!["trip", "group", "traveler", "accompagnatore", "guida"].includes(audienceScope))
      return NextResponse.json({ error: "Destinatari non validi" }, { status: 400 });
    const { agencyId } = await requireAgencyDepartureDayDocumentAudience({
      departureId,
      dayId,
      actorId: actor.id,
      partyId: ["trip", "accompagnatore", "guida"].includes(audienceScope) ? null : partyId,
      travelerId: audienceScope === "traveler" ? travelerId : null,
    });
    await assertTenantStorageCapacity(agencyId, sizeBytes, "document");
    const audienceKey =
      audienceScope === "trip"
        ? "trip"
        : audienceScope === "group"
          ? `groups/${partyId}`
          : audienceScope === "traveler"
            ? `travelers/${travelerId}`
            : `staff/${audienceScope}`;
    const key = `agencies/${agencyId}/departures/${departureId}/${audienceKey}/days/${dayId}/documents/${crypto.randomUUID()}.${file.extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, file.contentType, 10 * 60));
  } catch (error) {
    return platformApiError(error, "Preparazione del documento non riuscita");
  }
}
