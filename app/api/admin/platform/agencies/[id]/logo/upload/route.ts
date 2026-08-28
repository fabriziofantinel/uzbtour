import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { platformApiError } from "@/lib/platform/http";

export const runtime="nodejs";
const MAX_LOGO_BYTES=2*1024*1024;
const extensions:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    await requireSuperAdmin();
    const {id}=await context.params;
    if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Agenzia non valida"},{status:400});
    const body=await request.json().catch(()=>null) as {contentType?:unknown;sizeBytes?:unknown}|null;
    const contentType=typeof body?.contentType==="string"?body.contentType.toLowerCase():"";
    const sizeBytes=Number(body?.sizeBytes);
    const extension=extensions[contentType];
    if(!extension||!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>MAX_LOGO_BYTES){
      return NextResponse.json({error:"Logo non valido: usa PNG, JPG o WebP fino a 2 MB"},{status:400});
    }
    const key=`agencies/${id}/branding/${crypto.randomUUID()}.${extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(key,contentType,10*60));
  }catch(error){return platformApiError(error,"Preparazione del logo non riuscita");}
}
