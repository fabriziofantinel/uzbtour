import "server-only";

import { getSql } from "@/lib/db";

export type PrivateDownloadAsset = {
  provider: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
};

function assetFromRow(row: Record<string, unknown> | undefined): PrivateDownloadAsset | null {
  if (!row) return null;
  return {
    provider: String(row.provider),
    bucket: String(row.bucket),
    objectKey: String(row.object_key),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
  };
}

export async function resolveV3MemoryDownload(userId: string, memoryId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT provider,bucket,object_key,original_name,content_type
    FROM app.resolve_legacy_memory_download(${userId},${memoryId}::uuid)
  `;
  return assetFromRow(rows[0]);
}

export async function resolveV3TravelDocumentDownload(userId: string, documentId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT provider,bucket,object_key,original_name,content_type
    FROM app.resolve_legacy_travel_document_download(${userId},${documentId}::uuid)
  `;
  return assetFromRow(rows[0]);
}
