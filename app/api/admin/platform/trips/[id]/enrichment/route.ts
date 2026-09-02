import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import { getTripEnrichmentQueueRecord } from "@/lib/platform/repository";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Viaggio non valido" }, { status: 400 });
    }
    const queued = await getTripEnrichmentQueueRecord(id);
    const actor = await requireAgencyAdmin(queued.agencyId);
    const limited = await enforceApiRateLimit(
      request,
      { scope: "ai.trip-enrichment", limit: 10, windowSeconds: 3600 },
      actor.id,
    );
    if (limited) return limited;
    const job = await getJobQueue().enqueue({
      actorId: actor.id,
      agencyId: queued.agencyId,
      type: "travel-reference.enrich",
      payload: queued.payload,
      // A manual retry must create a new job. Reusing the publication key would
      // return the already completed job and silently skip materialization.
      idempotencyKey: `${queued.idempotencyKey}:retry:${crypto.randomUUID()}`,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return platformApiError(error, "Nuovo tentativo di generazione non riuscito");
  }
}
