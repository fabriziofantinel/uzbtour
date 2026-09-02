import "server-only";

import { getSql } from "@/lib/db";

export type UsernameLoginState = "unknown" | "invited" | "disabled" | "disabled_agency" | "unassigned" | "active";

export async function readUsernameLoginState(username: string): Promise<UsernameLoginState> {
  const sql = getSql();
  const rows = await sql`SELECT app.read_username_login_state(${username}) state`;
  return String(rows[0]?.state || "unknown") as UsernameLoginState;
}
