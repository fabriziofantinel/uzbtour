import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTripBelongsToAgency, assertTripHasNoProgramme } from "@/lib/platform/repository";
import {
  isMatchingTravelDocument,
  TRAVEL_DOCUMENT_MAX_BYTES,
  travelDocumentType,
} from "@/lib/platform/travel-document";

export const runtime = "nodejs";

const UPLOAD_EXPIRY_SECONDS = 10 * 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const agencyId = cleanText(body?.agencyId, 64);
    const templateId = cleanText(body?.templateId, 64);
    const originalName = cleanText(body?.originalName, 240);
    const contentType = cleanText(body?.contentType, 100).toLowerCase();
    const sizeBytes = Number(body?.sizeBytes);
    if (
      !agencyId || !templateId || !isMatchingTravelDocument(originalName, contentType) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > TRAVEL_DOCUMENT_MAX_BYTES
    ) {
      return NextResponse.json({ error: "Documento non valido: usa PDF, DOC o DOCX fino a 4,5 MB" }, { status: 400 });
    }

    await requireAgencyAdmin(agencyId);
    await assertTripBelongsToAgency(agencyId, templateId);
    await assertTripHasNoProgramme(agencyId, templateId);
    const documentType = travelDocumentType(originalName)!;
    const key = `agencies/${agencyId}/trips/${templateId}/documents/${crypto.randomUUID()}.${documentType.extension}`;
    const authorization = await getObjectStorage().createUploadAuthorization(
      key,
      documentType.contentType,
      UPLOAD_EXPIRY_SECONDS
    );
    return NextResponse.json(authorization);
  } catch (error) {
    return platformApiError(error, "Preparazione del caricamento non riuscita");
  }
}
