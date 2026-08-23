import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requireSuperAdmin } from "@/lib/platform/authorization";
import { getSuperadminSummary } from "@/lib/platform/superadmin-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(await getSuperadminSummary());
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Riepilogo superadmin non disponibile", error);
    return NextResponse.json({ error: "Riepilogo non disponibile" }, { status: 503 });
  }
}
