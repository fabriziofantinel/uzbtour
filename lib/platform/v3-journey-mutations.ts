import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

type Row=Record<string,unknown>;
function scope(actorId:string,agencyId:string,departureId:string,partyId:string,dayId:string){return {actorId,agencyId,departureId,partyId,dayId};}

export async function saveTravelerNoteV3(input:{agencyId:string;userId:string;departureId:string;partyId:string;dayId:string;text:string}){
 const sql=getSql(),s=scope(input.userId,input.agencyId,input.departureId,input.partyId,input.dayId),operationId=randomUUID();
 const [,rows]=await sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${s.agencyId},true)`,txn`
  WITH actor AS (SELECT traveler.id FROM travel.traveler_profiles traveler JOIN travel.party_memberships membership
    ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id
   AND membership.departure_id=${s.departureId} AND membership.party_id=${s.partyId} AND membership.status='active'
    WHERE traveler.agency_id=${s.agencyId} AND traveler.user_id=app.resolve_legacy_user_id(${s.actorId},${s.agencyId})),
  day AS (SELECT id FROM travel.departure_days WHERE agency_id=${s.agencyId} AND departure_id=${s.departureId} AND template_day_id=${s.dayId}),
  changed AS (INSERT INTO journey.day_notes(agency_id,departure_id,party_id,departure_day_id,note_text,updated_by_traveler_id,client_operation_id)
    SELECT ${s.agencyId},${s.departureId},${s.partyId},day.id,${input.text},actor.id,${operationId} FROM actor,day
    ON CONFLICT(party_id,departure_day_id) DO UPDATE SET note_text=EXCLUDED.note_text,updated_by_traveler_id=EXCLUDED.updated_by_traveler_id,updated_at=clock_timestamp()
    RETURNING id,updated_at) SELECT id::text,updated_at::text FROM changed`]);
 if(!rows[0])throw new PlatformRequestError("Nota non disponibile");return{id:String(rows[0].id),updatedAt:String(rows[0].updated_at)};
}

export async function addTravelerRestaurantV3(input:{agencyId:string;userId:string;departureId:string;partyId:string;dayId:string;name:string;clientOperationId?:string}){
 const sql=getSql(),operationId=input.clientOperationId??randomUUID(),s=scope(input.userId,input.agencyId,input.departureId,input.partyId,input.dayId);
 const [,rows]=await sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${s.agencyId},true)`,txn`
  WITH actor AS (SELECT traveler.id FROM travel.traveler_profiles traveler JOIN travel.party_memberships membership
    ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id
   AND membership.departure_id=${s.departureId} AND membership.party_id=${s.partyId} AND membership.status='active'
    WHERE traveler.agency_id=${s.agencyId} AND traveler.user_id=app.resolve_legacy_user_id(${s.actorId},${s.agencyId})),
  day AS (SELECT id FROM travel.departure_days WHERE agency_id=${s.agencyId} AND departure_id=${s.departureId} AND template_day_id=${s.dayId}),
  inserted AS (INSERT INTO journey.restaurant_visits(agency_id,departure_id,party_id,departure_day_id,name,added_by_traveler_id,client_operation_id)
    SELECT ${s.agencyId},${s.departureId},${s.partyId},day.id,${input.name},actor.id,${operationId} FROM actor,day
    ON CONFLICT(party_id,client_operation_id) DO NOTHING RETURNING id,created_at)
  SELECT id::text,created_at::text FROM inserted UNION ALL SELECT id::text,created_at::text FROM journey.restaurant_visits
   WHERE party_id=${s.partyId} AND client_operation_id=${operationId} AND NOT EXISTS(SELECT 1 FROM inserted) LIMIT 1`]);
 if(!rows[0])throw new PlatformRequestError("Locale non disponibile");return{id:String(rows[0].id),createdAt:String(rows[0].created_at)};
}

export async function addTravelerCashMovementV3(input:{agencyId:string;userId:string;departureId:string;partyId:string;dayId:string;kind:"withdrawal"|"exchange";euroAmount:number|null;localAmount:number;clientOperationId:string}){
 const sql=getSql(),s=scope(input.userId,input.agencyId,input.departureId,input.partyId,input.dayId);
 const [,rows]=await sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${s.agencyId},true)`,txn`
  WITH actor AS (SELECT traveler.id FROM travel.traveler_profiles traveler JOIN travel.party_memberships membership
    ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id
   AND membership.departure_id=${s.departureId} AND membership.party_id=${s.partyId} AND membership.status='active'
    WHERE traveler.agency_id=${s.agencyId} AND traveler.user_id=app.resolve_legacy_user_id(${s.actorId},${s.agencyId})),
  day AS (SELECT id FROM travel.departure_days WHERE agency_id=${s.agencyId} AND departure_id=${s.departureId} AND template_day_id=${s.dayId}),
  inserted AS (INSERT INTO journey.cash_movements(agency_id,departure_id,party_id,departure_day_id,kind,source_amount_minor,source_currency,target_amount_minor,target_currency,applied_rate,added_by_traveler_id,client_operation_id)
    SELECT ${s.agencyId},${s.departureId},${s.partyId},day.id,${input.kind},CASE WHEN ${input.euroAmount}::numeric IS NULL THEN NULL ELSE round(${input.euroAmount}::numeric*100)::bigint END,
      'EUR',round(${input.localAmount}::numeric*power(10::numeric,currency.minor_unit))::bigint,'UZS',CASE WHEN ${input.euroAmount}::numeric IS NULL THEN NULL ELSE ${input.localAmount}::numeric/${input.euroAmount}::numeric END,actor.id,${input.clientOperationId}
    FROM actor,day JOIN ref.currencies currency ON currency.code='UZS' ON CONFLICT(party_id,client_operation_id) DO NOTHING RETURNING id,created_at)
  SELECT id::text,created_at::text FROM inserted UNION ALL SELECT id::text,created_at::text FROM journey.cash_movements
   WHERE party_id=${s.partyId} AND client_operation_id=${input.clientOperationId} AND NOT EXISTS(SELECT 1 FROM inserted) LIMIT 1`]);
 if(!rows[0])throw new PlatformRequestError("Movimento non disponibile");return{id:String(rows[0].id),createdAt:String(rows[0].created_at)};
}

export async function deleteTravelerCashMovementV3(input:{agencyId:string;userId:string;departureId:string;partyId:string;movementId:string}){
 const sql=getSql();const [,rows]=await sql.transaction(txn=>[txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,txn`
  DELETE FROM journey.cash_movements movement USING travel.traveler_profiles traveler,travel.party_memberships membership
  WHERE movement.id=${input.movementId} AND movement.agency_id=${input.agencyId} AND movement.departure_id=${input.departureId} AND movement.party_id=${input.partyId}
    AND traveler.agency_id=movement.agency_id AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
    AND membership.agency_id=movement.agency_id AND membership.departure_id=movement.departure_id AND membership.party_id=movement.party_id
    AND membership.traveler_id=traveler.id AND membership.status='active' RETURNING movement.id::text`]);
 if(!rows[0])throw new PlatformRequestError("Movimento non disponibile");
}
