import "server-only";
import { getSql } from "@/lib/db";
import { getAgencyProgramme } from "./programme-repository";
import { getJourneyManagement } from "./journey-repository";

export async function getAgencyDayDocuments(departureId: string, actorId: string, actorNativeId: string) {
  const programme = await getAgencyProgramme(departureId, actorId, actorNativeId);
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id',${programme.departure.agencyId},true)`,
      txn`SELECT document.id::text,document.departure_day_id::text AS day_id,
      document.party_id::text AS party_id,COALESCE(party.name,'Intero viaggio') AS party_name,
      document.traveler_id::text AS traveler_id,COALESCE(traveler.display_name,'') AS traveler_name,
      document.title,document.description,asset.content_type,asset.size_bytes,document.created_at::text
      FROM ops.travel_documents document
      JOIN ops.media_assets asset ON asset.id=document.media_asset_id AND asset.agency_id=document.agency_id
      LEFT JOIN travel.travel_parties party ON party.id=document.party_id
        AND party.agency_id=document.agency_id AND party.departure_id=document.departure_id
      LEFT JOIN travel.traveler_profiles traveler ON traveler.id=document.traveler_id AND traveler.agency_id=document.agency_id
      WHERE document.departure_id=${departureId} AND document.departure_day_id IS NOT NULL
        AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
      ORDER BY document.created_at DESC`,
    ],
    { readOnly: true },
  );
  const management = await getJourneyManagement(departureId, actorId, actorNativeId);
  return {
    departure: programme.departure,
    days: programme.days.map(({ id, number, offset, title, city }) => ({ id, number, offset, title, city })),
    groups: management.groups.map(({ id, name, code, travelers }) => ({ id, name, code, travelers })),
    documents: rows.map((row) => ({
      id: String(row.id),
      dayId: String(row.day_id),
      partyId: String(row.party_id),
      partyName: String(row.party_name),
      travelerId: row.traveler_id ? String(row.traveler_id) : null,
      travelerName: String(row.traveler_name || ""),
      title: String(row.title),
      description: String(row.description || ""),
      contentType: String(row.content_type),
      sizeBytes: Number(row.size_bytes || 0),
      createdAt: String(row.created_at),
      downloadUrl: `/api/travel-documents/${String(row.id)}/content?download=1`,
    })),
  };
}

export type AgencyDayDocuments = Awaited<ReturnType<typeof getAgencyDayDocuments>>;

export async function archiveAgencyDayDocument(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  documentId: string;
}) {
  const rows =
    await getSql()`SELECT app.archive_day_document_v3(${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,${input.documentId}::uuid) archived`;
  if (!rows[0]?.archived) throw new Error("Documento non disponibile");
}
