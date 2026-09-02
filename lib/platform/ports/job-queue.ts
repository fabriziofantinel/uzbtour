export type EnqueueJobInput = {
  actorId: string;
  agencyId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  availableAt?: Date;
  traceId?: string;
};

export type EnqueuedJob = {
  id: string;
  provider: "database" | "sqs";
  status: "queued" | "processing" | "completed" | "failed" | "dead_letter";
};

export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<EnqueuedJob>;
}
