import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformAuthorizationError, requireSuperAdmin } from "@/lib/platform/authorization";
import { createAgencyAgent, getAgencyRegistry } from "@/lib/platform/superadmin-repository";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";

export const dynamic = "force-dynamic";

const agentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  username: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
  email: z.email(),
  phone: z.string().trim().min(5).max(40),
  role: z.enum(["admin", "editor", "viewer"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await params;
    const parsed = agentSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !parsed.success) {
      return NextResponse.json({ error: "Dati agente non validi" }, { status: 400 });
    }
    const invitation = await createAgencyAgent({ agencyId: id, ...parsed.data, actorId: actor.id });
    let invitationEmailSent=false;
    if(invitation.activationToken){
      const activationUrl=new URL(`/attiva-account#token=${encodeURIComponent(invitation.activationToken)}`,request.url).toString();
      invitationEmailSent=await sendTravelerInvitation({email:parsed.data.email,name:parsed.data.name,
        username:parsed.data.username,activationUrl}).catch(()=>false);
    }
    const agency = (await getAgencyRegistry(actor.id)).find((item) => item.id === id);
    return NextResponse.json({ agency,invitationEmailSent,activationToken:invitation.activationToken }, { status: 201 });
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Creazione agente non riuscita";
    console.error("Creazione agente non riuscita", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
