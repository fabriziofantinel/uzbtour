import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import {
  assertTripBelongsToAgency,
  registerImportedDocument,
} from "@/lib/platform/repository";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function validDocumentPath(pathname: string, agencyId: string) {
  const escapedAgencyId = agencyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^agencies/${escapedAgencyId}/documents/[0-9a-f-]{36}\\.pdf$`,
    "i"
  ).test(pathname);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const agencyId = cleanText(body?.agencyId, 64);
    const templateId = cleanText(body?.templateId, 64);
    const pathname = cleanText(body?.pathname, 700);
    const originalName = cleanText(body?.originalName, 240);
    if (
      !agencyId || !templateId || !validDocumentPath(pathname, agencyId) ||
      !originalName.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json({ error: "Documento non valido" }, { status: 400 });
    }

    const actor = await requireAgencyAdmin(agencyId);
    await assertTripBelongsToAgency(agencyId, templateId);
    const blob = await head(pathname);
    if (blob.contentType !== "application/pdf") {
      return NextResponse.json({ error: "Il file caricato non è un PDF" }, { status: 400 });
    }

    const imported = await registerImportedDocument({
      agencyId,
      templateId,
      actorId: actor.id,
      pathname: blob.pathname,
      originalName,
      contentType: blob.contentType,
      sizeBytes: blob.size,
    });
    const job = await getJobQueue().enqueue({
      agencyId,
      type: "travel-programme.import",
      payload: {
        importId: imported.id,
        documentId: imported.document_id,
        templateId,
        pathname: blob.pathname,
      },
      idempotencyKey: `travel-programme.import:${imported.id}`,
    });

    return NextResponse.json({ import: imported, job }, { status: 201 });
  } catch (error) {
    return platformApiError(error, "Registrazione del programma non riuscita");
  }
}
