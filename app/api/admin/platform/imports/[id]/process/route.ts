import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getImportAgency, getImportQueueRecord } from "@/lib/platform/import-repository";
import { getJobQueue } from "@/lib/platform/job-queue";
import { getPlatformProviderConfig } from "@/lib/platform/provider-config";
import { processTravelImport } from "@/lib/platform/process-import";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Importazione non valida" }, { status: 400 });
    }
    const agencyId = await getImportAgency(id);
    await requireAgencyAdmin(agencyId);
    if (getPlatformProviderConfig().jobQueue === "sqs") {
      const queued = await getImportQueueRecord(id, agencyId);
      const job = await getJobQueue().enqueue({
        agencyId,
        type: queued.type,
        payload: queued.payload,
        idempotencyKey: queued.idempotencyKey,
      });
      return NextResponse.json({ import: { status: job.status }, job });
    }
    const result = await processTravelImport(id);
    return NextResponse.json({ import: result });
  } catch (error) {
    return platformApiError(error, "Elaborazione del PDF non riuscita");
  }
}
