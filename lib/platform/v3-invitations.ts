import "server-only";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export async function inspectV3AccountInvitation(tokenHash: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT display_name,email
    FROM app.inspect_account_invitation(${tokenHash})
  `;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return { name: String(row.display_name), email: String(row.email) };
}

export async function activateV3AccountInvitation(input: {
  tokenHash: string;
  subject: string;
  email: string;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT legacy_user_id,display_name,email
    FROM app.activate_account_invitation(
      ${input.tokenHash},${input.subject},${input.email}
    )
  `;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: String(row.legacy_user_id),
    name: String(row.display_name),
    email: String(row.email),
  };
}
