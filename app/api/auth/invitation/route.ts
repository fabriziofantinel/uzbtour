import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getNeonAuth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

const schema = z.object({ action: z.enum(["inspect", "activate"]), token: z.string().min(32).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invito non valido" }, { status: 400 });
  const sql = getSql();
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const rows = await sql`
    SELECT invitations.id::text, users.id AS user_id, users.display_name, users.email
    FROM user_invitations invitations
    JOIN platform_users users ON users.id = invitations.user_id
    WHERE invitations.token_hash = ${tokenHash} AND invitations.used_at IS NULL
      AND invitations.expires_at > NOW() AND users.status = 'invited'
    LIMIT 1
  `;
  const invitation = rows[0];
  if (!invitation) return NextResponse.json({ error: "Invito scaduto o già utilizzato" }, { status: 404 });
  if (parsed.data.action === "inspect") {
    return NextResponse.json({ name: String(invitation.display_name), email: String(invitation.email) });
  }
  const { data: session, error } = await getNeonAuth().getSession();
  if (error || !session?.user?.id || !session.user.email ||
      String(session.user.email).toLocaleLowerCase("en-US") !== String(invitation.email).toLocaleLowerCase("en-US")) {
    return NextResponse.json({ error: "Accedi con l’email associata all’invito" }, { status: 401 });
  }
  await sql.transaction((txn) => [
    txn`UPDATE platform_users SET auth_provider = 'neon', auth_subject = ${String(session.user.id)}, status = 'active', updated_at = NOW() WHERE id = ${String(invitation.user_id)}`,
    txn`UPDATE user_invitations SET used_at = NOW() WHERE id = ${String(invitation.id)}`,
    txn`UPDATE party_memberships SET status = 'active' WHERE traveler_id IN (SELECT id FROM traveler_profiles WHERE user_id = ${String(invitation.user_id)})`,
  ]);
  return NextResponse.json({ ok: true });
}
