import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDepartureCollaborator } from "@/lib/platform/authorization";
import { readRoomingList, saveRoomingList } from "@/lib/platform/rooming-list";

export const runtime = "nodejs";
const roomSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["single", "double", "matrimonial", "triple"]),
  specialRequirements: z.string().trim().max(1000),
  occupantIds: z.array(z.string().uuid()).max(3),
});
const bodySchema = z.object({
  stayId: z.string().uuid(),
  partyId: z.string().uuid(),
  rooms: z.array(roomSchema).max(100),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const actor = await requireDepartureCollaborator(id);
    return NextResponse.json(await readRoomingList(actor.nativeId, id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rooming list non disponibile" },
      { status: 403 },
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const actor = await requireDepartureCollaborator(id);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dati della rooming list non validi" }, { status: 400 });
    await saveRoomingList({ actorId: actor.nativeId, departureId: id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rooming list non salvata" },
      { status: 400 },
    );
  }
}
