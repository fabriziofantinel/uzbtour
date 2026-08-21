import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTripBelongsToAgency } from "@/lib/platform/repository";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

const MAX_PROGRAMME_BYTES = 30 * 1024 * 1024;
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
      !agencyId || !templateId || !originalName.toLowerCase().endsWith(".pdf") ||
      contentType !== "application/pdf" || !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 || sizeBytes > MAX_PROGRAMME_BYTES
    ) {
      return NextResponse.json({ error: "Documento PDF non valido o superiore a 30 MB" }, { status: 400 });
    }

    await requireAgencyAdmin(agencyId);
    await assertTripBelongsToAgency(agencyId, templateId);
    const key = `agencies/${agencyId}/trips/${templateId}/documents/${crypto.randomUUID()}.pdf`;
    const authorization = await getObjectStorage().createUploadAuthorization(
      key,
      "application/pdf",
      UPLOAD_EXPIRY_SECONDS
    );
    return NextResponse.json(authorization);
  } catch (error) {
    return platformApiError(error, "Preparazione del caricamento non riuscita");
  }
}
