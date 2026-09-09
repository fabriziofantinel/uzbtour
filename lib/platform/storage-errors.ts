type StorageServiceError = {
  name?: unknown;
  code?: unknown;
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: number };
};

export function isObjectRetentionLockedError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const serviceError = error as StorageServiceError;
  const identifier = [serviceError.name, serviceError.code, serviceError.Code].find(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (identifier === "ObjectLockedByBucketPolicy") return true;
  return (
    typeof serviceError.message === "string" &&
    /\bobject is locked by the bucket policy\b/i.test(serviceError.message) &&
    [undefined, 403, 409].includes(serviceError.$metadata?.httpStatusCode)
  );
}
