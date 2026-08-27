import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import type { EnqueueJobInput, EnqueuedJob, JobQueue } from "./ports/job-queue";

class DatabaseJobQueue implements JobQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueuedJob> {
    const sql = getSql();
    const rows = await sql`SELECT id::text,provider,status FROM app.enqueue_platform_job_v3(
      ${input.actorId},${input.agencyId},${input.type},'database',
      ${JSON.stringify(input.payload)}::jsonb,${input.idempotencyKey},
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

class SqsJobQueue implements JobQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueuedJob> {
    const sql = getSql();
    const rows = await sql`SELECT id::text,provider,status FROM app.enqueue_platform_job_v3(
      ${input.actorId},${input.agencyId},${input.type},'sqs',
      ${JSON.stringify(input.payload)}::jsonb,${input.idempotencyKey},
      ${input.availableAt?.toISOString() ?? new Date().toISOString()})`;
    const row = rows[0] as EnqueuedJob | undefined;
    if (!row) throw new Error("Impossibile registrare il lavoro SQS");
    if (row.status !== "queued") return row;

    try {
      await getSqsClient().send(new SendMessageCommand({
        QueueUrl: requiredEnvironment("AWS_SQS_IMPORT_QUEUE_URL"),
        MessageBody: JSON.stringify({
          version: 1,
          jobId: row.id,
          agencyId: input.agencyId,
          type: input.type,
          payload: input.payload,
        }),
      }));
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
