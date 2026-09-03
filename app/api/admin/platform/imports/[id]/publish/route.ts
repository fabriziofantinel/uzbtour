import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import {
  getImportAgency,
  getImportDocumentPublicationContext,
  getImportForReview,
  publishImport,
  saveNormalizedImportDocument,
} from "@/lib/platform/import-repository";
import { getObjectStorage } from "@/lib/platform/object-storage";
import {
  createNormalizedTravelDocument,
  NORMALIZED_TRAVEL_DOCUMENT_CONTENT_TYPE,
  normalizedTravelDocumentName,
} from "@/lib/platform/normalized-travel-document";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";
import { assertTenantStorageCapacity } from "@/lib/platform/storage-quota";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const experienceProfile = ["essential", "standard", "complete"].includes(String(body.experienceProfile))
      ? (String(body.experienceProfile) as "essential" | "standard" | "complete")
      : "complete";
    const agencyId = await getImportAgency(id);
    const actor = await requireAgencyAdmin(agencyId);
    const limited = await enforceApiRateLimit(
      request,
      { scope: "ai.import-publish", limit: 10, windowSeconds: 3600 },
      actor.id,
    );
    if (limited) return limited;
    const imported = await getImportForReview(id, agencyId);
    if (!imported.draft) {
      return NextResponse.json({ error: "Nessuna bozza da pubblicare" }, { status: 400 });
    }
    const blockingIssues = imported.draft.reconciliationIssues.filter(
      (issue) => issue.severity === "blocking" && !issue.resolved,
    );
    if (blockingIssues.length > 0) {
      return NextResponse.json(
        {
          error: `Risolvi le ${blockingIssues.length} anomalie bloccanti prima di pubblicare.`,
          issues: blockingIssues,
        },
        { status: 409 },
      );
    }
    const documentContext = await getImportDocumentPublicationContext(id, agencyId);
    const normalizedName = normalizedTravelDocumentName(imported.draft.title);
    const normalizedBytes = await createNormalizedTravelDocument(imported.draft, documentContext.sourceName);
    await assertTenantStorageCapacity(agencyId, normalizedBytes.byteLength, "document");
    const normalizedKey = `agencies/${agencyId}/trips/${documentContext.templateId}/published/${id}/${crypto.randomUUID()}/${normalizedName}`;
    const storage = getObjectStorage("r2");
    const normalizedObject = await storage.put(normalizedKey, normalizedBytes, NORMALIZED_TRAVEL_DOCUMENT_CONTENT_TYPE);
    try {
      await saveNormalizedImportDocument({
        importId: id,
        agencyId,
        templateId: documentContext.templateId,
        uploadedByUserId: documentContext.uploadedByUserId ?? actor.id,
        provider: "r2",
        bucket: normalizedObject.bucket,
        objectKey: normalizedObject.key,
        originalName: normalizedName,
        contentType: normalizedObject.contentType,
        sizeBytes: normalizedObject.sizeBytes,
        checksumSha256: createHash("sha256").update(normalizedBytes).digest("hex"),
      });
    } catch (error) {
      await storage.delete(normalizedKey).catch(() => undefined);
      throw error;
    }
    const published = await publishImport({
      importId: id,
      agencyId,
      actorId: actor.id,
      draft: imported.draft,
      experienceProfile,
    });
    const enrichmentJob = await getJobQueue().enqueue({
      actorId: actor.nativeId,
      agencyId,
      type: "travel-reference.enrich",
      payload: {
        importId: id,
        templateId: published.templateId,
        targets: published.referenceTargets,
        experienceProfile,
      },
      // Ogni pubblicazione deve avviare la verifica dei contenuti. La chiave
      // include l'oggetto normalizzato, univoco per questo tentativo.
      idempotencyKey: `travel-reference.enrich:${id}:${createHash("sha256").update(normalizedObject.key).digest("hex").slice(0, 20)}`,
    });
    return NextResponse.json({ ok: true, ...published, enrichmentJob });
  } catch (error) {
    return platformApiError(error, "Pubblicazione del programma non riuscita");
  }
}
