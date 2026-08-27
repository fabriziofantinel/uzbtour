import "server-only";

import { getSql } from "@/lib/db";

type StoredObject = {
  provider: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

export async function registerV3MemoryUpload(input: StoredObject & {
  userId: string;
  departureId: string;
  partyId: string;
  dayId: string;
  mediaId: string;
  memoryId: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT memory_id::text,created_at::text
    FROM app.register_legacy_memory_upload(
      ${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,
      ${input.dayId}::uuid,${input.mediaId}::uuid,${input.memoryId}::uuid,
      ${input.provider},${input.bucket},${input.objectKey},${input.originalName},
      ${input.contentType},${input.sizeBytes}::bigint
    )
  `;
  return { id: String(rows[0].memory_id), createdAt: String(rows[0].created_at) };
}

export async function registerV3TicketUpload(input: StoredObject & {
  userId: string;
  departureId: string;
  itemId: string;
  mediaId: string;
  documentId: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT document_id::text,title,created_at::text
    FROM app.register_legacy_ticket_upload(
      ${input.userId},${input.departureId}::uuid,${input.itemId}::uuid,
      ${input.mediaId}::uuid,${input.documentId}::uuid,${input.provider},
      ${input.bucket},${input.objectKey},${input.originalName},${input.contentType},
      ${input.sizeBytes}::bigint
    )
  `;
  return {
    id: String(rows[0].document_id),
    title: String(rows[0].title),
    createdAt: String(rows[0].created_at),
  };
}

export async function isMediaObjectRegistered(objectKey: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT EXISTS(
      SELECT 1 FROM ops.media_assets
      WHERE object_key=${objectKey} AND status<>'deleted' AND deleted_at IS NULL
    ) AS registered
  `;
  return Boolean(rows[0]?.registered);
}

export async function deleteV3LegacyDemoMedia(
  userId: string,
  kind: "photo" | "contest",
  mediaId: string,
) {
  const sql = getSql();
  const rows = await sql`
    SELECT deleted,object_key,reason
    FROM app.delete_legacy_demo_media(${userId},${kind},${mediaId}::bigint)
  `;
  const row = rows[0];
  return {
    deleted: Boolean(row?.deleted),
    objectKey: row?.object_key ? String(row.object_key) : null,
    reason: row?.reason ? String(row.reason) : null,
  };
}
