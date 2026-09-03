import { z } from "zod";
import { getPlatformJobStatus } from "@/lib/platform/import-repository";
import { processTravelImport } from "@/lib/platform/process-import";
import { getImportTelemetryContext } from "@/lib/platform/import-repository";
import { loadWorkerParameters } from "@/lib/platform/worker-parameters";
import { processReferenceEnrichment } from "@/lib/platform/reference-enrichment";
import { processAgencyDeletion } from "@/lib/platform/agency-deletion";
import { processPhotoEvidenceValidation } from "@/lib/platform/photo-evidence-ai";
import { processPhotoContestEvaluation } from "@/lib/platform/photo-contest-ai";
import { withAiGenerationTelemetry } from "@/lib/platform/ai-generation-telemetry";

const messageSchema = z.object({
  version: z.literal(1),
  jobId: z.string().uuid(),
  agencyId: z.string().uuid(),
  traceId: z.string().uuid(),
  type: z.enum([
    "travel-programme.import",
    "travel-reference.enrich",
    "agency.delete",
    "photo-evidence.validate",
    "photo-contest.evaluate",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
const textractNotificationSchema = z.object({
  JobId: z.string().min(1),
  Status: z.enum(["SUCCEEDED", "FAILED", "PARTIAL_SUCCESS"]),
  JobTag: z.string().uuid(),
});
const snsEnvelopeSchema = z.object({ Type: z.literal("Notification"), Message: z.string() });

type SqsRecord = { messageId: string; body: string };
type SqsEvent = { Records: SqsRecord[] };
type ScheduledEvent = { source: "aws.events"; "detail-type": string };
type SqsBatchResponse = { batchItemFailures: Array<{ itemIdentifier: string }> };

const workloadTypes = {
  import: ["travel-programme.import"],
  enrichment: ["travel-reference.enrich"],
  photo: ["photo-evidence.validate", "photo-contest.evaluate"],
  deletion: ["agency.delete"],
} as const;

export async function handler(event: SqsEvent | ScheduledEvent): Promise<SqsBatchResponse> {
  const batchItemFailures: SqsBatchResponse["batchItemFailures"] = [];

  try {
    await loadWorkerParameters();
  } catch (error) {
    console.error("Worker parameter loading failed", {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      batchItemFailures:
        "Records" in event ? event.Records.map((record) => ({ itemIdentifier: record.messageId })) : [],
    };
  }
  if (!("Records" in event)) throw new Error("Evento schedulato non supportato dal worker di coda");
  const workload = z.enum(["import", "enrichment", "photo", "deletion"]).parse(process.env.WORKLOAD);

  for (const record of event.Records) {
    const startedAt = Date.now();
    try {
      const raw = JSON.parse(record.body);
      const sns = snsEnvelopeSchema.safeParse(raw);
      if (sns.success) {
        const notification = textractNotificationSchema.parse(JSON.parse(sns.data.Message));
        if (notification.Status !== "SUCCEEDED") throw new Error(`Textract OCR fallito: ${notification.Status}`);
        const telemetry = await getImportTelemetryContext(notification.JobTag);
        const result = await withAiGenerationTelemetry(telemetry, () =>
          processTravelImport(notification.JobTag, undefined, { textractJobId: notification.JobId }),
        );
        console.info("OCR import completed", {
          messageId: record.messageId,
          importId: notification.JobTag,
          result,
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      const message = messageSchema.parse(raw);
      if (!(workloadTypes[workload] as readonly string[]).includes(message.type)) {
        throw new Error(`Lavoro ${message.type} ricevuto dal worker ${workload}`);
      }
      console.info("Import job started", {
        messageId: record.messageId,
        jobId: message.jobId,
        agencyId: message.agencyId,
        traceId: message.traceId,
        importId: message.payload.importId,
      });
      try {
        const result = await withAiGenerationTelemetry(
          { agencyId: message.agencyId, platformJobId: message.jobId },
          async () =>
            message.type === "travel-programme.import"
              ? await processTravelImport(z.string().uuid().parse(message.payload.importId), {
                  jobId: message.jobId,
                  agencyId: message.agencyId,
                })
              : message.type === "travel-reference.enrich"
                ? await processReferenceEnrichment(
                    message.jobId,
                    message.agencyId,
                    z.string().uuid().parse(message.payload.templateId),
                    z
                      .array(
                        z.object({
                          entityType: z.enum(["country", "city", "site"]),
                          entityId: z.string().uuid(),
                          name: z.string().max(240),
                        }),
                      )
                      .parse(message.payload.targets),
                    z
                      .array(z.enum(["useful_info", "phrasebook", "bingo"]))
                      .default([])
                      .parse(message.payload.contentTypes),
                    z
                      .enum(["essential", "standard", "complete"])
                      .default("complete")
                      .parse(message.payload.experienceProfile),
                  )
                : message.type === "photo-evidence.validate"
                  ? await processPhotoEvidenceValidation({
                      jobId: message.jobId,
                      agencyId: message.agencyId,
                      userId: z.string().min(1).parse(message.payload.userId),
                      departureId: z.string().uuid().parse(message.payload.departureId),
                      partyId: z.string().uuid().parse(message.payload.partyId),
                      dayId: z.string().uuid().parse(message.payload.dayId),
                      itemId: z.string().uuid().parse(message.payload.itemId),
                      mediaId: z.string().uuid().parse(message.payload.mediaId),
                      resultId: z.string().uuid().parse(message.payload.resultId),
                      attemptNumber: z.number().int().min(1).max(2).parse(message.payload.attemptNumber),
                    })
                  : message.type === "photo-contest.evaluate"
                    ? await processPhotoContestEvaluation({
                        jobId: message.jobId,
                        agencyId: message.agencyId,
                        departureId: z.string().uuid().parse(message.payload.departureId),
                        partyId: z.string().uuid().parse(message.payload.partyId),
                        itemId: z.string().uuid().parse(message.payload.itemId),
                        entryIds: z.array(z.string().uuid()).length(2).parse(message.payload.entryIds),
                      })
                    : await processAgencyDeletion(
                        message.jobId,
                        message.agencyId,
                        z.string().uuid().parse(message.payload.deletionJobId),
                      ),
        );
        console.info("Import job completed", {
          messageId: record.messageId,
          jobId: message.jobId,
          agencyId: message.agencyId,
          traceId: message.traceId,
          importId: message.payload.importId,
          result,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (message.type === "agency.delete") throw error;
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
