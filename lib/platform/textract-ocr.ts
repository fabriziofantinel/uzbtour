import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

const region = process.env.AWS_REGION || "eu-central-1";
const s3 = new S3Client({ region, maxAttempts: 5, retryMode: "adaptive" });
const textract = new TextractClient({ region, maxAttempts: 5, retryMode: "adaptive" });

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} non configurata`);
  return value;
}
export function ocrObjectKey(importId: string) {
  return `ocr-input/${importId}/source.pdf`;
}

export async function startImportOcr(importId: string, bytes: Uint8Array) {
  const bucket = required("OCR_TEMP_BUCKET"),
    key = ocrObjectKey(importId);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    }),
  );
  try {
    const result = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        ClientRequestToken: importId,
        JobTag: importId,
        NotificationChannel: { RoleArn: required("OCR_TEXTRACT_ROLE_ARN"), SNSTopicArn: required("OCR_TOPIC_ARN") },
      }),
    );
    if (!result.JobId) throw new Error("Textract non ha restituito JobId");
    return result.JobId;
  } catch (error) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    throw error;
  }
}

export async function readImportOcr(jobId: string) {
  const lines: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await textract.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId, MaxResults: 1000, NextToken: nextToken }),
    );
    if (page.JobStatus !== "SUCCEEDED") throw new Error(`Textract OCR non completato: ${page.JobStatus || "UNKNOWN"}`);
    for (const block of page.Blocks || []) if (block.BlockType === "LINE" && block.Text) lines.push(block.Text);
    nextToken = page.NextToken;
  } while (nextToken);
  const text = lines.join("\n").trim();
  if (!text) throw new Error("Textract non ha estratto testo dal documento");
  return new TextEncoder().encode(text);
}

export async function cleanupImportOcr(importId: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: required("OCR_TEMP_BUCKET"), Key: ocrObjectKey(importId) }));
}
