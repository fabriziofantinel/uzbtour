import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { assertTripBelongsToAgency } from "@/lib/platform/repository";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

const MAX_PROGRAMME_BYTES = 30 * 1024 * 1024;

type DocumentUploadPayload = {
  agencyId?: string;
  templateId?: string;
  originalName?: string;
};

function validDocumentPath(pathname: string, agencyId: string) {
  return new RegExp(
    `^agencies/${agencyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/documents/[0-9a-f-]{36}\\.pdf$`,
    "i"
  ).test(pathname);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload ?? "{}") as DocumentUploadPayload;
        const agencyId = cleanText(payload.agencyId, 64);
        const templateId = cleanText(payload.templateId, 64);
        const originalName = cleanText(payload.originalName, 240);
        if (
          !agencyId || !templateId || !originalName.toLowerCase().endsWith(".pdf") ||
          !validDocumentPath(pathname, agencyId)
        ) {
          throw new Error("Documento o percorso non valido");
        }

        const actor = await requireAgencyAdmin(agencyId);
        await assertTripBelongsToAgency(agencyId, templateId);
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_PROGRAMME_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ agencyId, templateId, originalName, actorId: actor.id }),
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    return platformApiError(error, "Caricamento del programma non riuscito");
  }
}
