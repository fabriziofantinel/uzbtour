import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl=process.env.DATABASE_URL;
if(!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");
const client=new Client(runtimeUrl);
try{
  await client.connect();
  const role=(await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates=(await client.query(`SELECT
    has_function_privilege(current_user,'app.register_legacy_memory_upload(text,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') memory,
    has_function_privilege(current_user,'app.register_legacy_ticket_upload(text,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') ticket,
    has_function_privilege(current_user,'app.delete_legacy_demo_media(text,text,bigint)','EXECUTE') legacy_delete,
    NOT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') identity_map_private`)).rows[0];
  if(!gates||Object.values(gates).some((value)=>value!==true)) throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);

  const foreignDelete=(await client.query(
    "SELECT deleted,reason FROM app.delete_legacy_demo_media($1,'photo',0)",
    [randomUUID()],
  )).rows[0];
  if(foreignDelete?.deleted!==false||foreignDelete?.reason!=="not_found")
    throw new Error(`Risposta delete inattesa: ${JSON.stringify(foreignDelete)}`);

  const foreignUser=randomUUID();
  let memoryScopeDenied=false;
  try{
    await client.query(`SELECT * FROM app.register_legacy_memory_upload(
      $1,$2,$3,$4,$5,$6,'r2','smoke','invalid/key','smoke.jpg','image/jpeg',1)`,
      [foreignUser,randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
  }catch(error){memoryScopeDenied=error?.code==="42501";}
  if(!memoryScopeDenied) throw new Error("Registrazione ricordo estranea non respinta");

  let ticketScopeDenied=false;
  try{
    await client.query(`SELECT * FROM app.register_legacy_ticket_upload(
      $1,$2,$3,$4,$5,'r2','smoke','invalid/key','smoke.pdf','application/pdf',1)`,
      [foreignUser,randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
  }catch(error){ticketScopeDenied=error?.code==="42501";}
  if(!ticketScopeDenied) throw new Error("Registrazione biglietto estranea non respinta");

  console.log(JSON.stringify({status:"passed",role,gates,unknownMediaDenied:true,
    foreignMemoryDenied:memoryScopeDenied,foreignTicketDenied:ticketScopeDenied},null,2));
}finally{await client.end().catch(()=>undefined);}
