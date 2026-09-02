import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getPlatformOverview } from "@/lib/platform/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requirePlatformAdmin();
    return NextResponse.json(await getPlatformOverview(actor));
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Platform overview error", error);
    return NextResponse.json(
      { error: "Piattaforma non inizializzata o temporaneamente non disponibile" },
      { status: 503 },
    );
  }
}
