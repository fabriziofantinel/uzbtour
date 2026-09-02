import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { headers } from "next/headers";
import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import type { EnqueueJobInput, EnqueuedJob, JobQueue } from "./ports/job-queue";

class DatabaseJobQueue implements JobQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueuedJob> {
    const sql = getSql();
    const traceId = await resolveTraceId(input.traceId);
    const rows = await sql`SELECT id::text,provider,status FROM app.enqueue_platform_job_v3(
      ${input.actorId},${input.agencyId},${input.type},'database',
      ${JSON.stringify({ ...input.payload, _traceId: traceId })}::jsonb,${input.idempotencyKey},
      ${input.availableAt?.toISOString() ?? new Date().toISOString()})`;
    const row = rows[0] as EnqueuedJob | undefined;
    if (!row) throw new Error("Impossibile accodare il lavoro");
    return row;
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} non configurata`);
  return value;
}

let sqsClient: SQSClient | null = null;

function getSqsClient() {
  if (sqsClient) return sqsClient;
  const roleArn = process.env.AWS_ROLE_ARN?.trim();
  sqsClient = new SQSClient({
    region: requiredEnvironment("AWS_REGION"),
    ...(roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {}),
  });
  return sqsClient;
}

async function resolveTraceId(explicit?: string) {
  if (explicit && /^[0-9a-f-]{36}$/i.test(explicit)) return explicit;
  try {
    const incoming = (await headers()).get("x-smf-trace-id");
    if (incoming && /^[0-9a-f-]{36}$/i.test(incoming)) return incoming;
  } catch {}
  return crypto.randomUUID();
}

class SqsJobQueue implements JobQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueuedJob> {
    const sql = getSql();
    const traceId = await resolveTraceId(input.traceId);
    const payload = { ...input.payload, _traceId: traceId };
    const rows = await sql`SELECT id::text,provider,status FROM app.enqueue_platform_job_v3(
      ${input.actorId},${input.agencyId},${input.type},'sqs',
      ${JSON.stringify(payload)}::jsonb,${input.idempotencyKey},
      ${input.availableAt?.toISOString() ?? new Date().toISOString()})`;
    const row = rows[0] as EnqueuedJob | undefined;
    if (!row) throw new Error("Impossibile registrare il lavoro SQS");
    if (row.status !== "queued") return row;

    try {
      const queueEnvironment = {
        "travel-programme.import": "AWS_SQS_IMPORT_QUEUE_URL",
        "travel-reference.enrich": "AWS_SQS_ENRICHMENT_QUEUE_URL",
        "photo-evidence.validate": "AWS_SQS_PHOTO_QUEUE_URL",
        "photo-contest.evaluate": "AWS_SQS_PHOTO_QUEUE_URL",
        "agency.delete": "AWS_SQS_DELETION_QUEUE_URL",
      }[input.type];
      if (!queueEnvironment) throw new Error(`Tipo di lavoro SQS non instradabile: ${input.type}`);
      await getSqsClient().send(
        new SendMessageCommand({
          QueueUrl: requiredEnvironment(queueEnvironment),
          // On a Standard queue MessageGroupId enables SQS Fair Queues. This keeps
          // a high-volume agency from monopolising worker capacity without FIFO's
          // ordering and deduplication constraints.
          MessageGroupId: input.agencyId,
          MessageBody: JSON.stringify({
            version: 1,
            jobId: row.id,
            agencyId: input.agencyId,
            traceId,
            type: input.type,
            payload,
          }),
        }),
      );
      return row;
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Invio SQS non riuscito").slice(0, 1200);
      await sql`SELECT app.fail_platform_job_dispatch_v3(${input.actorId},${input.agencyId},
        ${row.id},${message})`;
      throw error;
    }
  }
}

export function getJobQueue(): JobQueue {
  const provider = getPlatformProviderConfig().jobQueue;
  if (provider === "database") return new DatabaseJobQueue();
  return new SqsJobQueue();
}
