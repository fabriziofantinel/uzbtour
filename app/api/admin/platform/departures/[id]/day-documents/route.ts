import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyDepartureDayGroup } from "@/lib/platform/programme-documents";
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
    const description = String(body?.description || "").trim();
    const objectKey = String(body?.objectKey || "");
    const file = dayDocumentFileDetails(body?.originalName, body?.contentType);
    if (!file || !description || description.length > 500)
      return NextResponse.json({ error: "Giornata, descrizione e documento sono obbligatori" }, { status: 400 });
    const { agencyId } = await requireAgencyDepartureDayGroup({ departureId, dayId, partyId, actorId: actor.id });
    const prefix = `agencies/${agencyId}/departures/${departureId}/parties/${partyId}/days/${dayId}/documents/`;
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
      departureId,
      dayId,
      partyId,
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
