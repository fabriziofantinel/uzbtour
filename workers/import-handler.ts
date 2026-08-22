import { z } from "zod";
import { getPlatformJobStatus } from "@/lib/platform/import-repository";
import { processTravelImport } from "@/lib/platform/process-import";
import { loadWorkerParameters } from "@/lib/platform/worker-parameters";

const messageSchema = z.object({
  version: z.literal(1),
  jobId: z.string().uuid(),
  agencyId: z.string().uuid(),
  type: z.literal("travel-programme.import"),
  payload: z.object({ importId: z.string().uuid() }).passthrough(),
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
        const result = await processTravelImport(message.payload.importId, {
          jobId: message.jobId,
          agencyId: message.agencyId,
        });
        console.info("Import job completed", {
          messageId: record.messageId,
          jobId: message.jobId,
          agencyId: message.agencyId,
          importId: message.payload.importId,
          status: result.status,
          model: result.model,
          days: result.days,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const status = await getPlatformJobStatus(message.jobId, message.agencyId).catch(() => null);
        if (status !== "completed") throw error;
        console.info("Duplicate import job acknowledged", {
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
