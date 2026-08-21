import { z } from "zod";
import { getPlatformJobStatus } from "@/lib/platform/import-repository";
import { processTravelImport } from "@/lib/platform/process-import";

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

  for (const record of event.Records) {
    try {
      const message = messageSchema.parse(JSON.parse(record.body));
      try {
        await processTravelImport(message.payload.importId, {
          jobId: message.jobId,
          agencyId: message.agencyId,
        });
      } catch (error) {
        const status = await getPlatformJobStatus(message.jobId, message.agencyId).catch(() => null);
        if (status !== "completed") throw error;
      }
    } catch (error) {
      console.error("Elaborazione messaggio import non riuscita", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
