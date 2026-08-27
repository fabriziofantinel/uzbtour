import { Client } from "@neondatabase/serverless";

const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Database non configurato");
const client=new Client(url);
try{
  await client.connect();
  const {rows}=await client.query(`SELECT
    app.read_username_login_state('ai.fabrizio.fantinel') state,
    (SELECT count(*)::integer FROM iam.agency_memberships
      WHERE role='owner' AND status<>'revoked') owner_count,
    (SELECT count(*)::integer FROM (
      SELECT agency_id FROM iam.agency_memberships
      WHERE role='owner' AND status<>'revoked'
      GROUP BY agency_id HAVING count(*)>1) duplicate) duplicate_owner_agencies,
    has_function_privilege('smf_app','app.read_username_login_state(text)','EXECUTE') runtime_login_state`);
  const result=rows[0];
  if(result.state!=="active"||Number(result.duplicate_owner_agencies)!==0||!result.runtime_login_state)
    throw new Error(`Smoke accesso agenzia fallito: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({status:"passed",...result},null,2));
}finally{await client.end().catch(()=>{});}
