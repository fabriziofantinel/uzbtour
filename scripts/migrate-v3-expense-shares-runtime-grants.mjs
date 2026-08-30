import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const name="099_v3_expense_shares_runtime_grants";
const model="3.66.0-expense-shares-runtime-grants";
const apply=process.argv.includes("--apply");
const url=process.env.DATABASE_MIGRATION_URL??process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL;
if(!url)throw new Error("Connessione Neon non configurata");
const source=await readFile(new URL(`../database/migrations/${name}.sql`,import.meta.url),"utf8");
const checksum=createHash("sha256").update(source).digest("hex");
const client=new Client(url);let open=false;
try{
  await client.connect();await client.query("BEGIN");open=true;
  await client.query("SET LOCAL lock_timeout='5s'");await client.query(source);
  const gate=(await client.query(`SELECT
    has_table_privilege('smf_app','journey.expense_shares','SELECT') select_ok,
    has_table_privilege('smf_app','journey.expense_shares','INSERT') insert_ok,
    NOT has_table_privilege('smf_app','journey.expense_shares','TRUNCATE') truncate_denied`)).rows[0];
  if(!gate||Object.values(gate).some(value=>value!==true))throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if(apply){
    await client.query(`UPDATE ops.schema_migrations SET checksum_sha256=$2,applied_at=clock_timestamp()
      WHERE version=$1`,[model,checksum]);await client.query("COMMIT");
  }else await client.query("ROLLBACK");
  open=false;console.log(JSON.stringify({status:apply?"applied":"dry_run_passed",gate}));
}catch(error){if(open)await client.query("ROLLBACK").catch(()=>{});throw error;}
finally{await client.end().catch(()=>{});}
