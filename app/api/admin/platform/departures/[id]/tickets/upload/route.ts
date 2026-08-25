import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { requireAgencyTicketItem } from "@/lib/platform/programme-documents";
import { MAX_TICKET_SIZE_BYTES, ticketFileDetails } from "@/lib/platform/travel-documents";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id: departureId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const itemId = String(body?.itemId || "");
    const sizeBytes = Number(body?.sizeBytes);
    const file = ticketFileDetails(body?.originalName, body?.contentType);
    if (!file || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_TICKET_SIZE_BYTES) {
      return NextResponse.json({ error: "Biglietto non valido o superiore a 25 MB" }, { status: 400 });
    }
    const { agencyId } = await requireAgencyTicketItem({ departureId, itemId, actorId: actor.id });
    const key = `agencies/${agencyId}/departures/${departureId}/tickets/${itemId}/${crypto.randomUUID()}.${file.extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, file.contentType, 10 * 60));
  } catch (error) {
    return platformApiError(error, "Preparazione del biglietto non riuscita");
  }
}
