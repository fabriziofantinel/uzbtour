import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL runtime non configurata");
const client=new Client(url);
try{await client.connect();const role=(await client.query("SELECT current_user role_name")).rows[0]?.role_name;
 const denied=(await client.query("SELECT * FROM app.read_journey_management($1,$2)",[randomUUID(),randomUUID()])).rowCount===0;
 const candidate=(await client.query(`SELECT actor.id actor_id,departure.id departure_id
  FROM public.agency_memberships membership JOIN public.platform_users actor ON actor.id=membership.user_id AND actor.status='active'
  JOIN public.departures departure ON departure.agency_id=membership.agency_id
  WHERE membership.role IN('owner','admin','editor') ORDER BY departure.created_at DESC LIMIT 1`)).rows[0];
 if(!candidate)throw new Error("Nessun viaggio amministrabile disponibile");
 const rows=await client.query("SELECT * FROM app.read_journey_management($1,$2)",[candidate.actor_id,candidate.departure_id]);
 if(!denied||rows.rowCount===0)throw new Error("Gate lettura journey V3 non superati");
 console.log(JSON.stringify({status:"passed",role,unauthorizedReadDenied:denied,authorizedRows:rows.rowCount},null,2));
}finally{await client.end().catch(()=>undefined);}
