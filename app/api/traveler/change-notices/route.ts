import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { platformApiError } from "@/lib/platform/http";
import { acknowledgeTravelerChangeNotice } from "@/lib/platform/traveler-change-notices";

const schema=z.object({noticeId:z.string().uuid(),clientOperationId:z.string().uuid()});
export async function POST(request:Request){try{const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Non autenticato"},{status:401});const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Dati non validi"},{status:400});await acknowledgeTravelerChangeNotice({userId:user.id,...parsed.data});return NextResponse.json({ok:true});}catch(error){return platformApiError(error,"Presa visione non registrata");}}
