import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getImportAgency, getNormalizedImportDocument } from "@/lib/platform/import-repository";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const agencyId = await getImportAgency(id);
    await requireAgencyAdmin(agencyId);
    const document = await getNormalizedImportDocument(id, agencyId);
    const storage = getObjectStorage("r2");
    if (document.provider !== storage.provider || document.bucket !== storage.bucket) {
      return NextResponse.json({ error: "Storage del preventivo non coerente" }, { status: 409 });
    }
    const filename = document.originalName.replace(/["\r\n]/g, "");
    const url = await storage.createDownloadUrl(document.objectKey, 5 * 60, {
      contentType: document.contentType,
      contentDisposition: `attachment; filename="${filename}"`,
    });
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return platformApiError(error, "Download del preventivo normalizzato non riuscito");
  }
}
