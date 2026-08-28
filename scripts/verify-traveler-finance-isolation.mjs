import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const databaseUrl=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL;
const userSelector=process.argv[2];
if(!databaseUrl||!userSelector)throw new Error("Connessione o utente non configurati");
const client=new Client(databaseUrl);
let transaction=false;
try{
  await client.connect();
  const candidates=(await client.query(`SELECT map.legacy_id AS legacy_user_id
    FROM iam.users account JOIN ops.legacy_id_map map ON map.target_id=account.id
      AND map.source_system='public-v2' AND map.entity_type='user'
    WHERE map.legacy_id=$1 OR lower(account.display_name) LIKE lower('%'||$1||'%')`,[userSelector])).rows;
  if(candidates.length!==1)throw new Error(`Il selettore utente deve individuare un solo profilo (trovati: ${candidates.length})`);
  const legacyUserId=candidates[0].legacy_user_id;
  const journey=(await client.query("SELECT * FROM app.list_legacy_user_journeys($1) LIMIT 1",[legacyUserId])).rows[0];
  if(!journey)throw new Error("Viaggio del viaggiatore non trovato");
  const context=(await client.query(`SELECT membership.traveler_id::text,day.id::text departure_day_id,
      (SELECT party.id::text FROM travel.travel_parties party WHERE party.agency_id=$1 AND party.departure_id=$2 AND party.id<>$3 LIMIT 1) other_party_id
    FROM travel.party_memberships membership JOIN travel.departure_days day
      ON day.agency_id=membership.agency_id AND day.departure_id=membership.departure_id
    WHERE membership.agency_id=$1 AND membership.departure_id=$2 AND membership.party_id=$3
      AND membership.status='active' ORDER BY day.service_date LIMIT 1`,
    [journey.agency_id,journey.departure_id,journey.party_id])).rows[0];
  if(!context)throw new Error("Contesto gruppo non disponibile");
  await client.query("BEGIN"); transaction=true;
  const expenseId=randomUUID(),withdrawalId=randomUUID(),exchangeId=randomUUID();
  await client.query(`INSERT INTO journey.expenses(id,agency_id,departure_id,party_id,departure_day_id,label,
      amount_minor,currency,base_currency,exchange_rate_to_base,base_amount_minor,paid_by_traveler_id,
      paid_by_name,allocation_method,allocation_status,client_operation_id)
    VALUES($1,$2,$3,$4,$5,'TEST ISOLAMENTO - rollback',100,'EUR','EUR',1,100,$6,'Test viaggiatore','whole_party','draft',$7)`,
    [expenseId,journey.agency_id,journey.departure_id,journey.party_id,context.departure_day_id,context.traveler_id,randomUUID()]);
  await client.query(`INSERT INTO journey.cash_movements(id,agency_id,departure_id,party_id,departure_day_id,kind,
      source_amount_minor,source_currency,target_amount_minor,target_currency,applied_rate,added_by_traveler_id,client_operation_id)
    VALUES($1,$2,$3,$4,$5,'withdrawal',NULL,'EUR',1400000,'UZS',NULL,$6,$7),
      ($8,$2,$3,$4,$5,'exchange',100,'EUR',1400000,'UZS',14000,$6,$9)`,
    [withdrawalId,journey.agency_id,journey.departure_id,journey.party_id,context.departure_day_id,context.traveler_id,randomUUID(),exchangeId,randomUUID()]);
  const visibility=(await client.query(`SELECT
      (SELECT count(*)::int FROM journey.expenses WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3 AND id=$5) current_expense,
      (SELECT count(*)::int FROM journey.expenses WHERE agency_id=$1 AND departure_id=$2 AND party_id=$4 AND id=$5) other_expense,
      (SELECT count(*)::int FROM journey.cash_movements WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3 AND id IN($6,$7)) current_cash,
      (SELECT count(*)::int FROM journey.cash_movements WHERE agency_id=$1 AND departure_id=$2 AND party_id=$4 AND id IN($6,$7)) other_cash`,
    [journey.agency_id,journey.departure_id,journey.party_id,context.other_party_id,expenseId,withdrawalId,exchangeId])).rows[0];
  if(visibility.current_expense!==1||visibility.other_expense!==0||visibility.current_cash!==2||visibility.other_cash!==0)
    throw new Error(`Isolamento gruppo fallito: ${JSON.stringify(visibility)}`);
  await client.query("ROLLBACK"); transaction=false;
  console.log(JSON.stringify({status:"passed_with_rollback",partyId:journey.party_id,otherPartyId:context.other_party_id,
    operations:{expense:true,withdrawal:true,exchange:true},visibility},null,2));
}catch(error){if(transaction)await client.query("ROLLBACK").catch(()=>undefined);throw error}
finally{await client.end().catch(()=>undefined)}
