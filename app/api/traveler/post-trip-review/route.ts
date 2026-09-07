import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { readOwnPostTripReview, saveOwnPostTripReview } from "@/lib/platform/post-trip-reviews";

export const runtime = "nodejs";
const querySchema = z.object({ departureId: z.string().uuid(), partyId: z.string().uuid() });
const bodySchema = querySchema.extend({
  rating: z.number().int().min(0).max(10),
  comment: z.string().trim().max(2000),
  clientOperationId: z.string().uuid(),
});

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      departureId: url.searchParams.get("departureId"),
      partyId: url.searchParams.get("partyId"),
    });
    if (!parsed.success) return NextResponse.json({ error: "Viaggio non valido" }, { status: 400 });
    return NextResponse.json(await readOwnPostTripReview(user.nativeId, parsed.data.departureId, parsed.data.partyId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Valutazione non disponibile" },
      { status: 403 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Valutazione non valida" }, { status: 400 });
    return NextResponse.json(await saveOwnPostTripReview({ actorId: user.nativeId, ...parsed.data }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Valutazione non salvata" },
      { status: 400 },
    );
  }
}
