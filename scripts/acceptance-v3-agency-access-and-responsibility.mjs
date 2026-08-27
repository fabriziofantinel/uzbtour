import { createHash,randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Database non configurato");
const client=new Client(url);let open=false;
try{
  await client.connect();await client.query("BEGIN");open=true;
  const actorRow=(await client.query(`SELECT map.legacy_id,users.email FROM ops.legacy_id_map map
    JOIN iam.users users ON users.id=map.target_id
    WHERE users.platform_role='superadmin' AND users.status='active' LIMIT 1`)).rows[0];
  const actor=actorRow?.legacy_id;
  if(!actor||!actorRow.email)throw new Error("Superadmin di collaudo non disponibile");
  const suffix=randomUUID().replaceAll("-","").slice(0,10),username=`accept.${suffix}`;
  const payload={slug:`acceptance-${suffix}`,name:`Acceptance ${suffix}`,referenceName:"Owner Acceptance",
    referenceUsername:username,referenceInitials:"OA",referenceEmail:actorRow.email,
    referencePhone:"3330000000",registeredCountry:"Italia",branding:{primaryColor:"#247A6B",logoUrl:""}};
  const token=createHash("sha256").update(randomUUID()).digest("hex");
  const created=(await client.query(`SELECT * FROM app.create_platform_agency_with_owner(
    $1,$2::jsonb,$3,clock_timestamp()+interval '14 days')`,[actor,JSON.stringify(payload),token])).rows[0];
  if(!created?.agency_id||!created.activation_required)throw new Error("Creazione agenzia/responsabile non atomica");
  const invited=(await client.query("SELECT app.read_username_login_state($1) state",[username])).rows[0].state;
  if(invited!=="invited")throw new Error(`Stato invito inatteso: ${invited}`);
  const ownerCount=Number((await client.query(`SELECT count(*) total FROM iam.agency_memberships
    WHERE agency_id=$1 AND role='owner' AND status<>'revoked'`,[created.agency_id])).rows[0].total);
  if(ownerCount!==1)throw new Error(`Responsabili attivi: ${ownerCount}`);
  await client.query(`UPDATE iam.users users SET status='active' FROM ops.legacy_id_map map
    WHERE map.legacy_id=$1 AND map.target_id=users.id`,[created.legacy_user_id]);
  await client.query(`UPDATE iam.agency_memberships membership SET status='active'
    FROM ops.legacy_id_map map WHERE map.legacy_id=$1 AND map.target_id=membership.user_id
      AND membership.agency_id=$2`,[created.legacy_user_id,created.agency_id]);
  await client.query(`INSERT INTO iam.user_identities(user_id,provider,subject)
    SELECT target_id,'cognito',$2 FROM ops.legacy_id_map WHERE legacy_id=$1`,[created.legacy_user_id,`acceptance-${suffix}`]);
  const active=(await client.query("SELECT app.read_username_login_state($1) state",[username])).rows[0].state;
  if(active!=="active")throw new Error(`Stato attivo inatteso: ${active}`);
  const replacementUsername=`${username}.new`;
  const replacementToken=createHash("sha256").update(randomUUID()).digest("hex");
  const replacement=(await client.query(`SELECT * FROM app.replace_platform_agency_owner(
    $1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '14 days')`,
    [actor,created.agency_id,"Replacement Owner","RO",replacementUsername,actorRow.email,
      "3330000001",replacementToken])).rows[0];
  if(!replacement?.legacy_user_id||!replacement.activation_required)
    throw new Error("Sostituzione responsabile non completata");
  const currentOwners=Number((await client.query(`SELECT count(*) total FROM iam.agency_memberships
    WHERE agency_id=$1 AND role='owner' AND status<>'revoked'`,[created.agency_id])).rows[0].total);
  const revokedOwners=Number((await client.query(`SELECT count(*) total FROM iam.agency_memberships
    WHERE agency_id=$1 AND role='owner' AND status='revoked'`,[created.agency_id])).rows[0].total);
  if(currentOwners!==1||revokedOwners<1)
    throw new Error(`Avvicendamento responsabile incompleto: ${currentOwners}/${revokedOwners}`);
  const registryOwners=Number((await client.query(`SELECT count(*) total
    FROM app.read_superadmin_agency_registry($1)
    WHERE agency_id=$2 AND agent_role='owner' AND agent_status<>'revoked'`,
    [actor,created.agency_id])).rows[0].total);
  if(registryOwners!==1)throw new Error(`Registro agenzie incoerente dopo avvicendamento: ${registryOwners}`);
  const replacementSubject=`acceptance-replacement-${suffix}`;
  await client.query(`UPDATE iam.users users SET status='active' FROM ops.legacy_id_map map
    WHERE map.legacy_id=$1 AND map.target_id=users.id`,[replacement.legacy_user_id]);
  await client.query(`UPDATE iam.agency_memberships membership SET status='active'
    FROM ops.legacy_id_map map WHERE map.legacy_id=$1 AND map.target_id=membership.user_id
      AND membership.agency_id=$2`,[replacement.legacy_user_id,created.agency_id]);
  await client.query(`INSERT INTO iam.user_identities(user_id,provider,subject)
    SELECT target_id,'cognito',$2 FROM ops.legacy_id_map WHERE legacy_id=$1`,
    [replacement.legacy_user_id,replacementSubject]);
  await client.query("SELECT app.update_platform_agency_status($1,$2,'suspended')",[actor,created.agency_id]);
  const disabled=(await client.query("SELECT app.read_username_login_state($1) state",[replacementUsername])).rows[0].state;
  const resolved=(await client.query("SELECT count(*)::integer total FROM app.resolve_cognito_authenticated_user($1)",[replacementSubject])).rows[0].total;
  if(disabled!=="disabled_agency"||Number(resolved)!==0)throw new Error(`Blocco agenzia incompleto: ${disabled}/${resolved}`);
  await client.query("ROLLBACK");open=false;
  console.log(JSON.stringify({status:"passed",gates:{atomicCreate:true,sharedEmail:true,pendingInvite:true,singleOwner:true,
    activeAgencyAccess:true,ownerReplacement:true,suspendedAgencyBlocked:true}},null,2));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}
finally{await client.end().catch(()=>{});}
