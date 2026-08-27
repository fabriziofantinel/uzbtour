import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import { getTripEnrichmentQueueRecord } from "@/lib/platform/repository";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Viaggio non valido" }, { status: 400 });
    }
    const queued = await getTripEnrichmentQueueRecord(id);
    const actor=await requireAgencyAdmin(queued.agencyId);
    const job = await getJobQueue().enqueue({
      actorId: actor.id,
      agencyId: queued.agencyId,
      type: "travel-reference.enrich",
      payload: queued.payload,
      idempotencyKey: queued.idempotencyKey,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return platformApiError(error, "Nuovo tentativo di generazione non riuscito");
  }
}
