import "server-only";
import { getSql } from "@/lib/db";

export async function readTravelerChangeNotices(input:{agencyId:string;departureId:string;userId:string}){
 const sql=getSql();
 const rows=await sql`SELECT notice.id::text,notice.departure_day_id::text,notice.itinerary_item_id::text,
  notice.change_type,notice.severity,notice.title,notice.summary,notice.previous_value,notice.current_value,
  notice.published_at::text,receipt.read_at::text
 FROM ops.traveler_change_notices notice
 JOIN travel.party_memberships membership ON membership.agency_id=notice.agency_id AND membership.departure_id=notice.departure_id AND membership.status='active'
 JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
 JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=profile.user_id AND map.legacy_id=${input.userId}
 LEFT JOIN ops.traveler_change_notice_receipts receipt ON receipt.notice_id=notice.id AND receipt.traveler_id=profile.id
 WHERE notice.agency_id=${input.agencyId} AND notice.departure_id=${input.departureId}
 ORDER BY notice.published_at DESC LIMIT 100`;
 return rows.map(row=>({id:String(row.id),dayId:row.departure_day_id?String(row.departure_day_id):null,itemId:row.itinerary_item_id?String(row.itinerary_item_id):null,
  changeType:String(row.change_type),severity:String(row.severity),title:String(row.title),summary:String(row.summary),
  previousValue:row.previous_value,currentValue:row.current_value,publishedAt:String(row.published_at),readAt:row.read_at?String(row.read_at):null}));
}

export async function acknowledgeTravelerChangeNotice(input:{userId:string;noticeId:string;clientOperationId:string}){
 const rows=await getSql()`SELECT app.acknowledge_traveler_change_notice_v3(${input.userId},${input.noticeId}::uuid,${input.clientOperationId}::uuid) acknowledged`;
 return Boolean(rows[0]?.acknowledged);
}
