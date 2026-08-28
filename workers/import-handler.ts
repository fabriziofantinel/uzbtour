import { z } from "zod";
import { getPlatformJobStatus } from "@/lib/platform/import-repository";
import { processTravelImport } from "@/lib/platform/process-import";
import { loadWorkerParameters } from "@/lib/platform/worker-parameters";
import { processReferenceEnrichment } from "@/lib/platform/reference-enrichment";
import { processAgencyDeletion } from "@/lib/platform/agency-deletion";

const messageSchema = z.object({
  version: z.literal(1),
  jobId: z.string().uuid(),
  agencyId: z.string().uuid(),
  type: z.enum(["travel-programme.import", "travel-reference.enrich", "agency.delete"]),
  payload: z.record(z.string(), z.unknown()),
});

type SqsRecord = { messageId: string; body: string };
type SqsEvent = { Records: SqsRecord[] };
type SqsBatchResponse = { batchItemFailures: Array<{ itemIdentifier: string }> };

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
  const batchItemFailures: SqsBatchResponse["batchItemFailures"] = [];

  try {
    await loadWorkerParameters();
  } catch (error) {
    console.error("Worker parameter loading failed", {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      batchItemFailures: event.Records.map((record) => ({ itemIdentifier: record.messageId })),
    };
  }

  for (const record of event.Records) {
    const startedAt = Date.now();
    try {
      const message = messageSchema.parse(JSON.parse(record.body));
      console.info("Import job started", {
        messageId: record.messageId,
        jobId: message.jobId,
        agencyId: message.agencyId,
        importId: message.payload.importId,
      });
      try {
        const result = message.type === "travel-programme.import"
          ? await processTravelImport(z.string().uuid().parse(message.payload.importId), { jobId: message.jobId, agencyId: message.agencyId })
          : message.type === "travel-reference.enrich" ? await processReferenceEnrichment(
              message.jobId,
              message.agencyId,
              z.string().uuid().parse(message.payload.templateId),
              z.array(z.object({ entityType: z.enum(["country", "city", "site"]), entityId: z.string().uuid(), name: z.string().max(240) })).parse(message.payload.targets),
              z.array(z.enum(["useful_info", "phrasebook", "bingo"])).default([]).parse(message.payload.contentTypes)
            ) : await processAgencyDeletion(message.jobId,message.agencyId,
              z.string().uuid().parse(message.payload.deletionJobId));
        console.info("Import job completed", {
          messageId: record.messageId,
          jobId: message.jobId,
          agencyId: message.agencyId,
          importId: message.payload.importId,
          result,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if(message.type==="agency.delete") throw error;
        const status = await getPlatformJobStatus(message.jobId, message.agencyId).catch(() => null);
        if (status !== "completed" && status !== null) throw error;
        console.info(status === null ? "Obsolete import job acknowledged" : "Duplicate import job acknowledged", {
          messageId: record.messageId,
          jobId: message.jobId,
          agencyId: message.agencyId,
          importId: message.payload.importId,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      console.error("Import job failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.name : "UnknownError",
        durationMs: Date.now() - startedAt,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
