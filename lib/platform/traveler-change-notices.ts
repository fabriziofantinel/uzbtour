import "server-only";
import { getSql } from "@/lib/db";

export async function readTravelerChangeNotices(input: { agencyId: string; departureId: string; userId: string }) {
  const sql = getSql();
  const rows = await sql`SELECT id::text,departure_day_id::text,itinerary_item_id::text,
  change_type,severity,title,summary,previous_value,current_value,published_at::text,read_at::text
 FROM app.list_traveler_change_notices_v3(${input.userId},${input.agencyId}::uuid,${input.departureId}::uuid,100)`;
  return rows.map((row) => ({
    id: String(row.id),
    dayId: row.departure_day_id ? String(row.departure_day_id) : null,
    itemId: row.itinerary_item_id ? String(row.itinerary_item_id) : null,
    changeType: String(row.change_type),
    severity: String(row.severity),
    title: String(row.title),
    summary: String(row.summary),
    previousValue: row.previous_value,
    currentValue: row.current_value,
    publishedAt: String(row.published_at),
    readAt: row.read_at ? String(row.read_at) : null,
  }));
}

export async function acknowledgeTravelerChangeNotice(input: {
  userId: string;
  noticeId: string;
  clientOperationId: string;
}) {
  const rows =
    await getSql()`SELECT app.acknowledge_traveler_change_notice_v3(${input.userId},${input.noticeId}::uuid,${input.clientOperationId}::uuid) acknowledged`;
  return Boolean(rows[0]?.acknowledged);
}
