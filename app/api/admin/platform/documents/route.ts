import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import { getObjectStorage } from "@/lib/platform/object-storage";
import {
  assertTripBelongsToAgency,
  registerImportedDocument,
} from "@/lib/platform/repository";
import {
  isMatchingTravelDocument,
  TRAVEL_DOCUMENT_MAX_BYTES,
  travelDocumentExtension,
} from "@/lib/platform/travel-document";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function validDocumentPath(pathname: string, agencyId: string, templateId: string) {
  const escapedAgencyId = agencyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTemplateId = templateId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^agencies/${escapedAgencyId}/trips/${escapedTemplateId}/documents/[0-9a-f-]{36}\\.(pdf|doc|docx)$`,
    "i"
  ).test(pathname);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const agencyId = cleanText(body?.agencyId, 64);
    const templateId = cleanText(body?.templateId, 64);
    const objectKey = cleanText(body?.objectKey, 700);
    const originalName = cleanText(body?.originalName, 240);
    if (
      !agencyId || !templateId || !validDocumentPath(objectKey, agencyId, templateId) ||
      !travelDocumentExtension(originalName)
    ) {
      return NextResponse.json({ error: "Documento non valido" }, { status: 400 });
    }

    const actor = await requireAgencyAdmin(agencyId);
    await assertTripBelongsToAgency(agencyId, templateId);
    const storage = getObjectStorage();
    const object = await storage.head(objectKey);
    if (!isMatchingTravelDocument(originalName, object.contentType)) {
      return NextResponse.json({ error: "Il file caricato non è un PDF, DOC o DOCX valido" }, { status: 400 });
    }
    if (object.sizeBytes <= 0 || object.sizeBytes > TRAVEL_DOCUMENT_MAX_BYTES) {
      await storage.delete(objectKey).catch(() => undefined);
      return NextResponse.json({ error: "Il documento è vuoto o supera il limite di 4,5 MB" }, { status: 400 });
    }

    const imported = await registerImportedDocument({
      agencyId,
      templateId,
      actorId: actor.id,
      provider: object.provider,
      bucket: object.bucket,
      objectKey: object.key,
      originalName,
      contentType: object.contentType,
      sizeBytes: object.sizeBytes,
    });
    const job = await getJobQueue().enqueue({
      agencyId,
      type: "travel-programme.import",
      payload: {
        importId: imported.id,
        documentId: imported.document_id,
        templateId,
        objectKey: object.key,
      },
      idempotencyKey: `travel-programme.import:${imported.id}`,
    });

    return NextResponse.json({ import: imported, job }, { status: 201 });
  } catch (error) {
    return platformApiError(error, "Registrazione del programma non riuscita");
  }
}
