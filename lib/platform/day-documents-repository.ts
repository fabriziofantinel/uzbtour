import "server-only";
import { getSql } from "@/lib/db";
import { getAgencyProgramme } from "./programme-repository";

export async function getAgencyDayDocuments(departureId: string, actorId: string) {
  const programme = await getAgencyProgramme(departureId, actorId);
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${programme.departure.agencyId},true)`,
    txn`SELECT document.id::text,document.departure_day_id::text AS day_id,
      document.title,document.description,asset.content_type,asset.size_bytes,document.created_at::text
      FROM ops.travel_documents document
      JOIN ops.media_assets asset ON asset.id=document.media_asset_id AND asset.agency_id=document.agency_id
      WHERE document.departure_id=${departureId} AND document.departure_day_id IS NOT NULL
        AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
      ORDER BY document.created_at DESC`,
  ], { readOnly: true });
  return { departure: programme.departure, days: programme.days.map(({ id, number, offset, title, city }) => ({ id, number, offset, title, city })),
    documents: rows.map((row) => ({ id: String(row.id), dayId: String(row.day_id), title: String(row.title),
      description: String(row.description || ""), contentType: String(row.content_type), sizeBytes: Number(row.size_bytes || 0),
      createdAt: String(row.created_at), downloadUrl: `/api/travel-documents/${String(row.id)}/content?download=1` })) };
}

export type AgencyDayDocuments = Awaited<ReturnType<typeof getAgencyDayDocuments>>;
