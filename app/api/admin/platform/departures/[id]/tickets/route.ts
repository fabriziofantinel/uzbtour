import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyTicketItem } from "@/lib/platform/programme-documents";
import { ensureProgrammeFeedbackSchema } from "@/lib/platform/programme-feedback-schema";
import { MAX_TICKET_SIZE_BYTES, TICKET_CONTENT_TYPES, ticketFileDetails } from "@/lib/platform/travel-documents";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    await ensureProgrammeFeedbackSchema();
    const { id: departureId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const itemId = String(body?.itemId || "");
    const objectKey = String(body?.objectKey || "");
    const file = ticketFileDetails(body?.originalName, body?.contentType);
    if (!file) return NextResponse.json({ error: "Formato biglietto non valido" }, { status: 400 });
    const { agencyId } = await requireAgencyTicketItem({ departureId, itemId, actorId: actor.id });
    const prefix = `agencies/${agencyId}/departures/${departureId}/tickets/${itemId}/`;
    if (!objectKey.startsWith(prefix)) return NextResponse.json({ error: "Percorso biglietto non valido" }, { status: 400 });
    const storage = getObjectStorage();
    const object = await storage.head(objectKey);
    if (!TICKET_CONTENT_TYPES.includes(object.contentType as typeof TICKET_CONTENT_TYPES[number]) ||
        object.sizeBytes <= 0 || object.sizeBytes > MAX_TICKET_SIZE_BYTES) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è un biglietto valido" }, { status: 400 });
    }
    const mediaId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const sql = getSql();
    const rows = await sql.transaction((txn) => [
      txn`
        INSERT INTO media_assets (id, agency_id, departure_id, uploaded_by_user_id, provider, bucket,
          object_key, original_name, content_type, size_bytes, purpose, visibility, status)
        VALUES (${mediaId}, ${agencyId}, ${departureId}, ${actor.id}, ${storage.provider}, ${storage.bucket},
          ${objectKey}, ${file.originalName}, ${object.contentType}, ${object.sizeBytes}, 'travel_ticket', 'departure', 'ready')
      `,
      txn`
        INSERT INTO itinerary_item_documents (id, agency_id, departure_id, itinerary_item_id,
          media_asset_id, document_type, title, created_by_user_id)
        VALUES (${documentId}, ${agencyId}, ${departureId}, ${itemId}, ${mediaId}, 'ticket', ${file.originalName}, ${actor.id})
        RETURNING id::text, title, created_at::text
      `,
    ]);
    return NextResponse.json({ ticket: {
      id: documentId, title: String(rows[1][0].title), contentType: object.contentType,
      sizeBytes: object.sizeBytes, createdAt: String(rows[1][0].created_at),
      downloadUrl: `/api/travel-documents/${documentId}/content?download=1`,
    } });
  } catch (error) {
    return platformApiError(error, "Registrazione del biglietto non riuscita");
  }
}
