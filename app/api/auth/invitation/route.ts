import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getNeonAuth } from "@/lib/auth/server";
import { activateV3AccountInvitation, inspectV3AccountInvitation } from "@/lib/platform/v3-invitations";

const schema = z.object({ action: z.enum(["inspect", "activate"]), token: z.string().min(32).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invito non valido" }, { status: 400 });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invitation = await inspectV3AccountInvitation(tokenHash);
  if (!invitation) return NextResponse.json({ error: "Invito scaduto o già utilizzato" }, { status: 404 });
  if (parsed.data.action === "inspect") {
    return NextResponse.json(invitation);
  }
  const { data: session, error } = await getNeonAuth().getSession();
  if (error || !session?.user?.id || !session.user.email ||
      String(session.user.email).toLocaleLowerCase("en-US") !== invitation.email.toLocaleLowerCase("en-US")) {
    return NextResponse.json({ error: "Accedi con l’email associata all’invito" }, { status: 401 });
  }
  const activated = await activateV3AccountInvitation({
    tokenHash,
    subject: String(session.user.id),
    email: String(session.user.email),
  });
  if (!activated) {
    return NextResponse.json({ error: "Invito scaduto o già utilizzato" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
