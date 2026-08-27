import {getSql} from "@/lib/db";import {PlatformRequestError} from "./errors";
type Input={agencyId:string;userId:string;departureId:string;partyId:string;dayId:string;targetId:string;targetType:"itinerary_item"|"hotel";rating:number;clientOperationId:string};
export async function saveTravelerProgrammeFeedbackV3(input:Input){
 const sql=getSql();
 const statement=input.targetType==="itinerary_item"?sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,txn`
  WITH actor AS (SELECT traveler.id FROM travel.traveler_profiles traveler JOIN travel.party_memberships membership
    ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id AND membership.departure_id=${input.departureId}
   AND membership.party_id=${input.partyId} AND membership.status='active' WHERE traveler.agency_id=${input.agencyId}
   AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})),
  day AS (SELECT id FROM travel.departure_days WHERE agency_id=${input.agencyId} AND departure_id=${input.departureId} AND template_day_id=${input.dayId}),
  item AS (SELECT item.id FROM travel.departure_itinerary_items item,day WHERE item.agency_id=${input.agencyId}
    AND item.departure_id=${input.departureId} AND item.departure_day_id=day.id AND item.source_template_item_id=${input.targetId}),
  changed AS (INSERT INTO journey.programme_feedback(agency_id,departure_id,party_id,traveler_id,departure_day_id,target_type,departure_item_id,hotel_id,rating,comment,client_operation_id)
    SELECT ${input.agencyId},${input.departureId},${input.partyId},actor.id,day.id,'itinerary_item',item.id,NULL,${input.rating},'',${input.clientOperationId}
    FROM actor,day,item ON CONFLICT(party_id,traveler_id,departure_item_id) WHERE target_type='itinerary_item'
    DO UPDATE SET rating=EXCLUDED.rating,client_operation_id=EXCLUDED.client_operation_id,updated_at=clock_timestamp() RETURNING id,rating,updated_at)
  SELECT id::text,rating,updated_at::text FROM changed`])
 :sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,txn`
  WITH actor AS (SELECT traveler.id FROM travel.traveler_profiles traveler JOIN travel.party_memberships membership
    ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id AND membership.departure_id=${input.departureId}
   AND membership.party_id=${input.partyId} AND membership.status='active' WHERE traveler.agency_id=${input.agencyId}
   AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})),
  day AS (SELECT id FROM travel.departure_days WHERE agency_id=${input.agencyId} AND departure_id=${input.departureId} AND template_day_id=${input.dayId}),
  hotel AS (SELECT hotel.id FROM ref.hotels hotel JOIN travel.template_day_hotels link ON link.hotel_id=hotel.id
    WHERE link.template_day_id=${input.dayId} AND hotel.id=${input.targetId}),
  changed AS (INSERT INTO journey.programme_feedback(agency_id,departure_id,party_id,traveler_id,departure_day_id,target_type,departure_item_id,hotel_id,rating,comment,client_operation_id)
    SELECT ${input.agencyId},${input.departureId},${input.partyId},actor.id,day.id,'hotel',NULL,hotel.id,${input.rating},'',${input.clientOperationId}
    FROM actor,day,hotel ON CONFLICT(party_id,traveler_id,departure_day_id,hotel_id) WHERE target_type='hotel'
    DO UPDATE SET rating=EXCLUDED.rating,client_operation_id=EXCLUDED.client_operation_id,updated_at=clock_timestamp() RETURNING id,rating,updated_at)
  SELECT id::text,rating,updated_at::text FROM changed`]);
 const [,rows]=await statement;if(!rows[0])throw new PlatformRequestError("Valutazione non disponibile");return rows[0];
}
