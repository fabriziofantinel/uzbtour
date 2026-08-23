import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformAuthorizationError, requireSuperAdmin } from "@/lib/platform/authorization";
import { createAgencyAgent, getAgencyRegistry } from "@/lib/platform/superadmin-repository";

export const dynamic = "force-dynamic";

const agentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email(),
  phone: z.string().trim().min(5).max(40),
  role: z.enum(["admin", "editor", "viewer"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const parsed = agentSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !parsed.success) {
      return NextResponse.json({ error: "Dati agente non validi" }, { status: 400 });
    }
    await createAgencyAgent({ agencyId: id, ...parsed.data });
    const agency = (await getAgencyRegistry()).find((item) => item.id === id);
    return NextResponse.json({ agency }, { status: 201 });
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Creazione agente non riuscita";
    console.error("Creazione agente non riuscita", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
