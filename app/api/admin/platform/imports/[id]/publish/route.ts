import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import {
  getImportAgency,
  getImportForReview,
  publishImport,
} from "@/lib/platform/import-repository";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const agencyId = await getImportAgency(id);
    const actor = await requireAgencyAdmin(agencyId);
    const imported = await getImportForReview(id, agencyId);
    if (!imported.draft) {
      return NextResponse.json({ error: "Nessuna bozza da pubblicare" }, { status: 400 });
    }
    const published = await publishImport({ importId: id, agencyId, actorId: actor.id, draft: imported.draft });
    const enrichmentJob = await getJobQueue().enqueue({
      agencyId,
      type: "travel-reference.enrich",
      payload: {
        importId: id,
        templateId: published.templateId,
        targets: published.referenceTargets,
      },
      idempotencyKey: `travel-reference.enrich:${id}`,
    });
    return NextResponse.json({ ok: true, ...published, enrichmentJob });
  } catch (error) {
    return platformApiError(error, "Pubblicazione del programma non riuscita");
  }
}
