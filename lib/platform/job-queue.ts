import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import type { EnqueueJobInput, EnqueuedJob, JobQueue } from "./ports/job-queue";

class DatabaseJobQueue implements JobQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueuedJob> {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO platform_jobs (
        agency_id, job_type, provider, status, payload, idempotency_key, available_at
      ) VALUES (
        ${input.agencyId}, ${input.type}, 'database', 'queued',
        ${JSON.stringify(input.payload)}::jsonb, ${input.idempotencyKey},
        ${input.availableAt?.toISOString() ?? new Date().toISOString()}
      )
      ON CONFLICT (agency_id, idempotency_key) DO UPDATE SET
        updated_at = platform_jobs.updated_at
      RETURNING id::text, provider, status
    `;
    const row = rows[0] as EnqueuedJob | undefined;
    if (!row) throw new Error("Impossibile accodare il lavoro");
    return row;
  }
}

export function getJobQueue(): JobQueue {
  const provider = getPlatformProviderConfig().jobQueue;
  if (provider === "database") return new DatabaseJobQueue();
  throw new Error("SQS sarà attivato nel piano di crescita; per la demo usa PLATFORM_JOB_QUEUE_PROVIDER=database");
}
