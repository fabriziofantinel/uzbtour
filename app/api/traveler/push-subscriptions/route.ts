import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
const schema=z.object({endpoint:z.string().url().max(2048),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().min(16).max(512),auth:z.string().min(8).max(256)})});
export const runtime="nodejs";
export async function POST(request:Request){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Non autenticato"},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Sottoscrizione non valida"},{status:400});
  const expiration=parsed.data.expirationTime?new Date(parsed.data.expirationTime).toISOString():null;
  const rows=await getSql()`SELECT app.upsert_own_web_push_subscription_v3(${user.id},${parsed.data.endpoint},${parsed.data.keys.p256dh},${parsed.data.keys.auth},${request.headers.get("user-agent")||""},${expiration}::timestamptz) id`;
  return NextResponse.json({ok:true,id:String(rows[0].id)});
}
