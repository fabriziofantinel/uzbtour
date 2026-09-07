import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentAgencyAdmin } from "@/lib/platform/authorization";
import { updateAgencyPostTripSettings } from "@/lib/platform/post-trip-reviews";

export const runtime = "nodejs";
const schema = z.object({
  agencyId: z.string().uuid(),
  publicReviewUrl: z.union([z.literal(""), z.string().url().startsWith("https://").max(1000)]),
});

export async function PUT(request: Request) {
  try {
    const actor = await requireCurrentAgencyAdmin();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Inserisci un indirizzo HTTPS valido" }, { status: 400 });
    await updateAgencyPostTripSettings(actor.nativeId, parsed.data.agencyId, parsed.data.publicReviewUrl);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impostazioni non salvate" },
      { status: 403 },
    );
  }
}
