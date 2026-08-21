export type EnqueueJobInput = {
  agencyId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  availableAt?: Date;
};

export type EnqueuedJob = {
  id: string;
  provider: "database" | "sqs";
  status: "queued";
};

export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<EnqueuedJob>;
}
