import type {
  JobQueueProvider,
  ObjectStorageProvider,
  PlatformProviderConfig,
  TravelAiProvider,
} from "./types";

function oneOf<T extends string>(value: string | undefined, fallback: T, allowed: readonly T[]): T {
  const candidate = value || fallback;
  if (!allowed.includes(candidate as T)) {
    throw new Error(`Provider non supportato: ${candidate}`);
  }
  return candidate as T;
}

export function getPlatformProviderConfig(): PlatformProviderConfig {
  return {
    objectStorage: oneOf<ObjectStorageProvider>(
      process.env.PLATFORM_OBJECT_STORAGE_PROVIDER,
      "r2",
      ["vercel-blob", "r2"]
    ),
    jobQueue: oneOf<JobQueueProvider>(
      process.env.PLATFORM_JOB_QUEUE_PROVIDER,
      "database",
      ["database", "sqs"]
    ),
    travelAi: oneOf<TravelAiProvider>(
      process.env.PLATFORM_AI_PROVIDER,
      "gemini",
      ["gemini", "bedrock"]
    ),
  };
}
