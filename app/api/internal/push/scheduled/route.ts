import {timingSafeEqual} from "node:crypto";
import {NextResponse} from "next/server";
import {getSql} from "@/lib/db";
import {sendDeparturePush} from "@/lib/platform/web-push";
function authorized(request:Request){const expected=process.env.CRON_SECRET||"",actual=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";return Boolean(expected)&&expected.length===actual.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(actual));}
export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:"Non autorizzato"},{status:401});
  const sql=getSql(),runs=await sql`SELECT run_id::text,departure_id::text,kind FROM app.claim_due_push_deliveries_v3()`;
  const results=[];
  for(const run of runs){try{const result=await sendDeparturePush({departureId:String(run.departure_id),kind:String(run.kind) as "quiz_unlock"|"departure_reminder"});await sql`SELECT app.complete_push_delivery_v3(${String(run.run_id)}::uuid,true,${result.sent},${result.revoked},NULL)`;results.push({runId:run.run_id,...result});}catch(error){const message=error instanceof Error?error.message:"Invio non riuscito";await sql`SELECT app.complete_push_delivery_v3(${String(run.run_id)}::uuid,false,0,0,${message})`;results.push({runId:run.run_id,error:message});}}
  return NextResponse.json({ok:true,claimed:runs.length,results});
}
