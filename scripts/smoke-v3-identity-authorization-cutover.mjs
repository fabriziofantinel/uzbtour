import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl=process.env.DATABASE_URL;
const ownerUrl=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED;
if(!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");
const client=new Client(runtimeUrl);
const owner=ownerUrl?new Client(ownerUrl):null;
try{
  await client.connect();
  if(owner) await owner.connect();
  const role=(await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates=(await client.query(`SELECT
    has_function_privilege(current_user,'app.resolve_neon_authenticated_user(text,text,text)','EXECUTE') authenticated,
    has_function_privilege(current_user,'app.resolve_legacy_user_access(text,uuid)','EXECUTE') access,
    has_function_privilege(current_user,'app.start_legacy_impersonation(text,text,text,timestamptz,text)','EXECUTE') start_impersonation,
    has_function_privilege(current_user,'app.resolve_legacy_impersonation(text,text)','EXECUTE') resolve_impersonation,
    has_function_privilege(current_user,'app.end_legacy_impersonation(text,text)','EXECUTE') end_impersonation,
    NOT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') identity_map_private`)).rows[0];
  if(!gates||Object.values(gates).some((value)=>value!==true)) throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);

  const unknownAccess=(await client.query(
    "SELECT * FROM app.resolve_legacy_user_access($1,NULL)",[randomUUID()],
  )).rowCount===0;
  const unknownAuth=(await client.query(
    "SELECT * FROM app.resolve_neon_authenticated_user($1,$2,$3)",
    [randomUUID(),`${randomUUID()}@invalid.example`,`Smoke ${randomUUID()}`],
  )).rowCount===0;
  let impersonationDenied=false;
  try{
    await client.query(`SELECT * FROM app.start_legacy_impersonation(
      $1,$2,$3,clock_timestamp()+interval '1 hour','smoke')`,
      [randomUUID(),randomUUID(),randomBytes(32).toString("hex")]);
  }catch(error){impersonationDenied=error?.code==="42501";}
  if(!unknownAccess||!unknownAuth||!impersonationDenied)
    throw new Error("Gate negativi IAM non superati");

  if(!owner) throw new Error("Connessione owner necessaria per preparare la fixture IAM");
  const candidates=(await owner.query(`SELECT users.id,
    users.platform_role='superadmin' AS expected_superadmin,
    EXISTS(SELECT 1 FROM public.agency_memberships membership
      WHERE membership.user_id=users.id AND membership.role IN ('owner','admin','editor')) AS expected_agency_admin
    FROM public.platform_users users WHERE users.status='active' ORDER BY users.id LIMIT 20`)).rows;
  for(const candidate of candidates){
    const access=(await client.query("SELECT * FROM app.resolve_legacy_user_access($1,NULL)",[candidate.id])).rows[0];
    if(!access?.is_active||access.is_superadmin!==candidate.expected_superadmin||
      access.is_agency_admin!==candidate.expected_agency_admin)
      throw new Error(`Accesso IAM non riconciliato per ${candidate.id}`);
  }

  console.log(JSON.stringify({status:"passed",role,gates,unknownAccessDenied:unknownAccess,
    unknownAuthenticationDenied:unknownAuth,foreignImpersonationDenied:impersonationDenied,
    reconciledActiveUsers:candidates.length},null,2));
}finally{await client.end().catch(()=>undefined);await owner?.end().catch(()=>undefined);}
