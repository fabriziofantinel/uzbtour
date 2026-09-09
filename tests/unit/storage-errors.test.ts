import { describe, expect, it } from "vitest";
import { isObjectRetentionLockedError } from "../../lib/platform/storage-errors";

describe("object storage errors", () => {
  it("recognizes an R2 object protected by the bucket retention policy", () => {
    const error = Object.assign(new Error("The object is locked by the bucket policy."), {
      name: "ObjectLockedByBucketPolicy",
      $metadata: { httpStatusCode: 403 },
    });

    expect(isObjectRetentionLockedError(error)).toBe(true);
  });

  it("recognizes the structurally serialized R2 error returned in production", () => {
    expect(
      isObjectRetentionLockedError({
        name: "ObjectLockedByBucketPolicy",
        message: "The object is locked by the bucket policy.",
        $metadata: { httpStatusCode: 409 },
      }),
    ).toBe(true);
  });

  it("recognizes the retention message when the SDK omits the error name", () => {
    expect(
      isObjectRetentionLockedError({
        message: "The object is locked by the bucket policy.",
        $metadata: { httpStatusCode: 403 },
      }),
    ).toBe(true);
  });

  it("does not hide unrelated storage failures", () => {
    const error = Object.assign(new Error("Service unavailable"), {
      name: "ServiceUnavailable",
      $metadata: { httpStatusCode: 503 },
    });

    expect(isObjectRetentionLockedError(error)).toBe(false);
  });
});
