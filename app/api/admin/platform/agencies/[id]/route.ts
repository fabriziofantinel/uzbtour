import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import {
  getAgencyRegistry,
  replaceAgencyOwner,
  requestAgencyDeletion,
  updateAgencyBranding,
  updateAgencyStatus,
} from "@/lib/platform/superadmin-repository";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brandingSchema = z.object({
  action: z.literal("branding").optional(),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: z.union([z.literal(""), z.url()]),
});
const statusSchema=z.object({action:z.literal("status"),status:z.enum(["trial","active","suspended"])});
const ownerSchema=z.object({action:z.literal("replace-owner"),name:z.string().trim().min(2).max(160),
  username:z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
  email:z.email(),phone:z.string().trim().min(5).max(40)});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    }
    const payload=await request.json().catch(()=>null);
    const status=statusSchema.safeParse(payload);
    if(status.success){
      await updateAgencyStatus({actorId:actor.id,agencyId:id,status:status.data.status});
      return NextResponse.json({agencies:await getAgencyRegistry(actor.id)});
    }
    const owner=ownerSchema.safeParse(payload);
    if(owner.success){
      const result=await replaceAgencyOwner({actorId:actor.id,agencyId:id,...owner.data});
      let invitationEmailSent=false;
      if(result.activationToken){
        const activationUrl=new URL(`/attiva-account#token=${encodeURIComponent(result.activationToken)}`,request.url).toString();
        invitationEmailSent=await sendTravelerInvitation({email:owner.data.email,name:owner.data.name,
          username:owner.data.username,activationUrl}).catch(()=>false);
      }
      return NextResponse.json({agencies:await getAgencyRegistry(actor.id),invitationEmailSent,
        activationToken:result.activationToken});
    }
    const branding = brandingSchema.safeParse(payload);
    if (!branding.success) return NextResponse.json({ error: "Operazione o dati non validi" }, { status: 400 });
    await updateAgencyBranding({ agencyId: id, primaryColor:branding.data.primaryColor,
      logoUrl:branding.data.logoUrl, actorId: actor.id });
    return NextResponse.json({ agencies: await getAgencyRegistry(actor.id) });
  } catch (error) {
    return platformApiError(error, "Branding dell’agenzia non aggiornato");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    }

    const deletion = await requestAgencyDeletion({
      actorId:actor.id,agencyId:id,reason:"Cancellazione richiesta dal superadmin tramite pannello piattaforma",
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      deletionJobId: deletion.deletionJobId,
      deletedAgency: deletion.agencyName,
      agencies: await getAgencyRegistry(actor.id),
    },{ status: 202 });
  } catch (error) {
    return platformApiError(error, "Eliminazione agenzia non riuscita");
  }
}
