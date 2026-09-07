import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyTicketItem } from "@/lib/platform/programme-documents";
import { assertProgrammeFeedbackSchema } from "@/lib/platform/schema-readiness";
import { MAX_TICKET_SIZE_BYTES, TICKET_CONTENT_TYPES, ticketFileDetails } from "@/lib/platform/travel-documents";
import { isMediaObjectRegistered, registerV3TicketUpload } from "@/lib/platform/v3-media-mutations";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedObjectKey = "";
  try {
    const actor = await requirePlatformAdmin();
    await assertProgrammeFeedbackSchema();
    const { id: departureId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const itemId = String(body?.itemId || "");
    const objectKey = String(body?.objectKey || "");
    const file = ticketFileDetails(body?.originalName, body?.contentType);
    if (!file) return NextResponse.json({ error: "Formato biglietto non valido" }, { status: 400 });
    const { agencyId } = await requireAgencyTicketItem({ departureId, itemId, actorId: actor.nativeId });
    const prefix = `agencies/${agencyId}/departures/${departureId}/tickets/${itemId}/`;
    if (!objectKey.startsWith(prefix))
      return NextResponse.json({ error: "Percorso biglietto non valido" }, { status: 400 });
    uploadedObjectKey = objectKey;
    const storage = getObjectStorage();
    const object = await storage.head(objectKey);
    if (
      !TICKET_CONTENT_TYPES.includes(object.contentType as (typeof TICKET_CONTENT_TYPES)[number]) ||
      object.sizeBytes <= 0 ||
      object.sizeBytes > MAX_TICKET_SIZE_BYTES
    ) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è un biglietto valido" }, { status: 400 });
    }
    const mediaId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const ticket = await registerV3TicketUpload({
      userId: actor.nativeId,
      departureId,
      itemId,
      mediaId,
      documentId,
      provider: storage.provider,
      bucket: storage.bucket,
      objectKey,
      originalName: file.originalName,
      contentType: object.contentType,
      sizeBytes: object.sizeBytes,
    });
    return NextResponse.json({
      ticket: {
        id: ticket.id,
        title: ticket.title,
        contentType: object.contentType,
        sizeBytes: object.sizeBytes,
        createdAt: ticket.createdAt,
        downloadUrl: `/api/travel-documents/${ticket.id}/content?download=1`,
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
    return platformApiError(error, "Registrazione del biglietto non riuscita");
  }
}
