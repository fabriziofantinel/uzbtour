import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl=process.env.DATABASE_URL;
if(!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");
const client=new Client(runtimeUrl); let open=false;
try{
  await client.connect();
  await client.query("BEGIN"); open=true;
  const candidate=(await client.query(`SELECT actor.id actor_id,
    departure.agency_id,departure.id departure_id
    FROM public.agency_memberships membership
    JOIN public.platform_users actor ON actor.id=membership.user_id
      AND actor.status='active'
    JOIN public.departures departure ON departure.agency_id=membership.agency_id
    WHERE membership.role IN('owner','admin','editor')
    ORDER BY departure.created_at DESC LIMIT 1`)).rows[0];
  if(!candidate) throw new Error("Nessuna partenza amministrabile disponibile per il collaudo");

  const suffix=randomUUID();
  const email=`acceptance-${suffix}@invalid.example`;
  const tokenHash=randomBytes(32).toString("hex");
  const partyId=(await client.query(
    "SELECT app.create_journey_party($1,$2,$3,$4,$5)::text id",
    [candidate.actor_id,candidate.agency_id,candidate.departure_id,
      `ACCEPTANCE-${suffix}`,"Famiglia collaudo rollback"],
  )).rows[0]?.id;
  const traveler=(await client.query(`SELECT traveler_id::text,activation_required
    FROM app.provision_journey_traveler($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[
    candidate.actor_id,candidate.agency_id,partyId,"Viaggiatore collaudo","VC",email,"",
    null,"member",tokenHash,new Date(Date.now()+3600000).toISOString(),
  ])).rows[0];
  const invitation=(await client.query(
    "SELECT * FROM app.inspect_account_invitation($1)",[tokenHash],
  )).rows[0];
  const reconciliation=(await client.query(`SELECT
    EXISTS(SELECT 1 FROM public.travel_parties WHERE id=$1) legacy_party,
    EXISTS(SELECT 1 FROM public.traveler_profiles WHERE id=$2) legacy_traveler,
    EXISTS(SELECT 1 FROM public.user_invitations WHERE token_hash=$3 AND used_at IS NULL) legacy_invitation`,
    [partyId,traveler?.traveler_id,tokenHash])).rows[0];
  const passed=partyId&&traveler?.activation_required===true&&invitation?.email===email
    &&Object.values(reconciliation).every((value)=>value===true);
  if(!passed) throw new Error(`Collaudo provisioning incompleto: ${JSON.stringify({traveler,invitation,reconciliation})}`);
  await client.query("ROLLBACK"); open=false;
  console.log(JSON.stringify({status:"passed",rolledBack:true,reconciliation},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
finally{await client.end().catch(()=>undefined);}
