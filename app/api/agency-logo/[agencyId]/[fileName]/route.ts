import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { platformApiError } from "@/lib/platform/http";

export const runtime="nodejs";

export async function GET(_request:Request,context:{params:Promise<{agencyId:string;fileName:string}>}){
  try{
    if(!await getCurrentUser())return NextResponse.json({error:"Non autenticato"},{status:401});
    const {agencyId,fileName}=await context.params;
    if(!/^[0-9a-f-]{36}$/i.test(agencyId)||!/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(fileName)){
      return NextResponse.json({error:"Logo non valido"},{status:400});
    }
    const key=`agencies/${agencyId}/branding/${fileName}`;
    const url=await getObjectStorage().createDownloadUrl(key,10*60,{contentType:fileName.toLowerCase().endsWith(".png")?"image/png":fileName.toLowerCase().endsWith(".webp")?"image/webp":"image/jpeg"});
    return NextResponse.redirect(url);
  }catch(error){return platformApiError(error,"Logo non disponibile");}
}
