import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { isUsernameAvailable } from "@/lib/platform/superadmin-repository";

export const dynamic = "force-dynamic";
const schema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
});

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Autenticazione richiesta" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ available: false, error: "Username non valido" }, { status: 400 });
  return NextResponse.json({ available: await isUsernameAvailable(actor.nativeId, parsed.data.username) });
}
