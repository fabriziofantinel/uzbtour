import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { registerDepartureInsuranceDocument } from "@/lib/platform/departure-operations";
import { platformApiError } from "@/lib/platform/http";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let objectKey = "";
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    objectKey = String(body?.objectKey || "");
    const originalName = String(body?.originalName || "")
      .trim()
      .slice(0, 500);
    const journey = await getJourneyManagement(id, actor.id, actor.nativeId);
    const prefix = `agencies/${journey.journey.agencyId}/departures/${id}/insurance/`;
    if (!objectKey.startsWith(prefix) || !originalName.toLowerCase().endsWith(".pdf"))
      return NextResponse.json({ error: "Documento assicurativo non valido" }, { status: 400 });
    const storage = getObjectStorage();
    const object = await storage.head(objectKey);
    if (object.contentType !== "application/pdf" || object.sizeBytes <= 0 || object.sizeBytes > 25 * 1024 * 1024) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il PDF caricato non è valido" }, { status: 400 });
    }
    const documentId = await registerDepartureInsuranceDocument({
      actorId: actor.id,
      departureId: id,
      provider: storage.provider,
      bucket: storage.bucket,
      objectKey,
      originalName,
      contentType: object.contentType,
      sizeBytes: object.sizeBytes,
    });
    return NextResponse.json({ documentId, title: originalName });
  } catch (error) {
    if (objectKey)
      await getObjectStorage()
        .delete(objectKey)
        .catch(() => undefined);
    return platformApiError(error, "Registrazione del documento assicurativo non riuscita");
  }
}
