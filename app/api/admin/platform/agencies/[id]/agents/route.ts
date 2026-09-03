import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { createAgencyAgent, readAgencyAgents, removeAgencyAgent } from "@/lib/platform/agency-agent-repository";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";
import { platformApiError } from "@/lib/platform/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(160),
        username: z
          .string()
          .trim()
          .min(3)
          .max(80)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
        email: z.email(),
        phone: z.string().trim().min(5).max(40),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Compila nome, username, email e telefono." }, { status: 400 });
    const created = await createAgencyAgent({ actorId: actor.nativeId, agencyId: id, ...parsed.data });
    let invitationEmailSent = false;
    if (created.activationToken) {
      const activationUrl = new URL(
        `/attiva-account#token=${encodeURIComponent(created.activationToken)}`,
        request.url,
      ).toString();
      invitationEmailSent = await sendTravelerInvitation({
        email: parsed.data.email,
        name: parsed.data.name,
        username: parsed.data.username,
        activationUrl,
      }).catch(() => false);
    }
    return NextResponse.json(
      { agents: await readAgencyAgents(actor.nativeId, id), invitationEmailSent },
      { status: 201 },
    );
  } catch (error) {
    return platformApiError(error, "Inserimento agente non riuscito");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    const parsed = z.object({ agentId: z.string().min(8).max(100) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Agente non valido" }, { status: 400 });
    await removeAgencyAgent(actor.nativeId, id, parsed.data.agentId);
    return NextResponse.json({ agents: await readAgencyAgents(actor.nativeId, id) });
  } catch (error) {
    return platformApiError(error, "Eliminazione agente non riuscita");
  }
}
