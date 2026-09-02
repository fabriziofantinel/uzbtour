import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";
import { platformApiError } from "@/lib/platform/http";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { assertTenantStorageCapacity } from "@/lib/platform/storage-quota";

export const runtime = "nodejs";
const maximumSize = 25 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const limited = await enforceApiRateLimit(
      request,
      { scope: "upload.insurance", limit: 10, windowSeconds: 600 },
      actor.id,
    );
    if (limited) return limited;
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sizeBytes = Number(body?.sizeBytes);
    const originalName = String(body?.originalName || "").trim();
    if (
      body?.contentType !== "application/pdf" ||
      !originalName.toLowerCase().endsWith(".pdf") ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > maximumSize
    )
      return NextResponse.json({ error: "Carica un PDF non superiore a 25 MB" }, { status: 400 });
    const journey = await getJourneyManagement(id, actor.id);
    await assertTenantStorageCapacity(journey.journey.agencyId, sizeBytes, "document");
    const key = `agencies/${journey.journey.agencyId}/departures/${id}/insurance/${crypto.randomUUID()}.pdf`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key, "application/pdf", 10 * 60));
  } catch (error) {
    return platformApiError(error, "Preparazione del documento assicurativo non riuscita");
  }
}
