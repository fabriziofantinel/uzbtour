import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/authorization";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  _context: { params: Promise<{ id: string }> }
) {
  await requireSuperAdmin();
  return NextResponse.json({error:"Gli agenti possono essere gestiti solo dal responsabile dell’agenzia."},{status:403});
}
