import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyDepartureDayDocumentAudience } from "@/lib/platform/programme-documents";
import {
  DAY_DOCUMENT_CONTENT_TYPES,
  MAX_TICKET_SIZE_BYTES,
  dayDocumentFileDetails,
} from "@/lib/platform/travel-documents";
import { isMediaObjectRegistered, registerV3DayDocument } from "@/lib/platform/v3-media-mutations";
import { archiveAgencyDayDocument } from "@/lib/platform/day-documents-repository";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedObjectKey = "";
  try {
    const actor = await requirePlatformAdmin();
    const { id: departureId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const dayId = String(body?.dayId || "");
    const partyId = String(body?.partyId || "");
    const travelerId = String(body?.travelerId || "");
    const audienceScope = String(body?.audienceScope || "group");
    const selectedStaff = z
      .array(z.string().uuid())
      .max(100)
      .safeParse(body?.staffUserIds ?? []);
    if (!selectedStaff.success || (["accompagnatore", "guida"].includes(audienceScope) && !selectedStaff.data.length))
      return NextResponse.json({ error: "Seleziona almeno una persona associata al viaggio" }, { status: 400 });
    const description = String(body?.description || "").trim();
    const objectKey = String(body?.objectKey || "");
    const file = dayDocumentFileDetails(body?.originalName, body?.contentType);
    if (!file || !description || description.length > 500)
      return NextResponse.json({ error: "Giornata, descrizione e documento sono obbligatori" }, { status: 400 });
    if (!["trip", "group", "traveler", "accompagnatore", "guida"].includes(audienceScope))
      return NextResponse.json({ error: "Destinatari non validi" }, { status: 400 });
    const targetPartyId = ["trip", "accompagnatore", "guida"].includes(audienceScope) ? null : partyId;
    const targetTravelerId = audienceScope === "traveler" ? travelerId : null;
    const { agencyId } = await requireAgencyDepartureDayDocumentAudience({
      departureId,
      dayId,
      actorId: actor.id,
      partyId: targetPartyId,
      travelerId: targetTravelerId,
    });
    const audienceKey =
      audienceScope === "trip"
        ? "trip"
        : audienceScope === "group"
          ? `groups/${partyId}`
          : audienceScope === "traveler"
            ? `travelers/${travelerId}`
            : `staff/${audienceScope}`;
    const prefix = `agencies/${agencyId}/departures/${departureId}/${audienceKey}/days/${dayId}/documents/`;
    if (!objectKey.startsWith(prefix))
      return NextResponse.json({ error: "Percorso documento non valido" }, { status: 400 });
    uploadedObjectKey = objectKey;
    const storage = getObjectStorage();
    const object = await storage.head(objectKey);
    if (
      !DAY_DOCUMENT_CONTENT_TYPES.includes(object.contentType as (typeof DAY_DOCUMENT_CONTENT_TYPES)[number]) ||
      object.sizeBytes <= 0 ||
      object.sizeBytes > MAX_TICKET_SIZE_BYTES
    ) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è valido" }, { status: 400 });
    }
    const document = await registerV3DayDocument({
      userId: actor.nativeId,
      staffUserIds: selectedStaff.data,
      departureId,
      dayId,
      partyId: targetPartyId,
      travelerId: targetTravelerId,
      audienceScope: audienceScope as "trip" | "group" | "traveler" | "accompagnatore" | "guida",
      mediaId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      provider: storage.provider,
      bucket: storage.bucket,
      objectKey,
      originalName: file.originalName,
      contentType: object.contentType,
      sizeBytes: object.sizeBytes,
      description,
    });
    return NextResponse.json({
      document: {
        ...document,
        contentType: object.contentType,
        sizeBytes: object.sizeBytes,
        dayId,
        partyId,
        staffRole: ["accompagnatore", "guida"].includes(audienceScope) ? audienceScope : null,
        staffUserIds: selectedStaff.data,
        downloadUrl: `/api/travel-documents/${document.id}/content?download=1`,
      },
    });
  } catch (error) {
    if (uploadedObjectKey) {
      const registered = await isMediaObjectRegistered(uploadedObjectKey).catch(() => true);
      if (!registered)
        await getObjectStorage()
          .delete(uploadedObjectKey)
          .catch(() => undefined);
    }
    return platformApiError(error, "Registrazione del documento non riuscita");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id: departureId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    await archiveAgencyDayDocument({
      actorId: actor.id,
      agencyId: String(body?.agencyId || ""),
      departureId,
      documentId: String(body?.documentId || ""),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Eliminazione del documento non riuscita");
  }
}
