import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getAuthProvider } from "@/lib/auth/auth-provider";
import { activateV3AccountInvitation, inspectV3AccountInvitation } from "@/lib/platform/v3-invitations";

const schema = z.object({
  action: z.enum(["inspect", "activate"]),
  token: z.string().min(32).max(200),
  password: z.string().min(10).max(256).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional(),
});

export async function POST(request: Request) {
  const auth = getAuthProvider();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invito non valido" }, { status: 400 });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invitation = await inspectV3AccountInvitation(tokenHash);
  if (!invitation) return NextResponse.json({ error: "Invito scaduto o già utilizzato" }, { status: 404 });
  if (parsed.data.action === "inspect") {
    return NextResponse.json(invitation);
  }
  if (!parsed.data.password) return NextResponse.json({ error: "Scegli una password" }, { status: 400 });
  let subject: string;
  try {
    subject = await auth.provisionInvitedUser({
      username: invitation.username,
      email: invitation.email,
      name: invitation.name,
      password: parsed.data.password,
    });
  } catch (error) {
    console.error("Cognito invitation activation failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Attivazione dell’account non riuscita" }, { status: 503 });
  }
  const activated = await activateV3AccountInvitation({
    tokenHash,
    subject,
    username: invitation.username,
  });
  if (!activated) {
    return NextResponse.json({ error: "Invito scaduto o già utilizzato" }, { status: 409 });
  }
  const authResult = await auth.signIn(invitation.username, parsed.data.password);
  const response = NextResponse.json({ ok: true });
  auth.setCookies(response, authResult);
  return response;
}
