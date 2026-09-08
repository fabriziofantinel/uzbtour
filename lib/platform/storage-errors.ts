type StorageServiceError = Error & {
  $metadata?: { httpStatusCode?: number };
};

export function isObjectRetentionLockedError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const serviceError = error as StorageServiceError;
  return (
    serviceError.name === "ObjectLockedByBucketPolicy" &&
    (serviceError.$metadata?.httpStatusCode == null || serviceError.$metadata.httpStatusCode === 403)
  );
}
