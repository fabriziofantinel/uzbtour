import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

export type AgencyAgent = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  status: "invited" | "active" | "suspended";
  createdAt: string;
  staffRole: "agent" | "accompagnatore" | "guida";
};

export async function readAgencyAgents(actorId: string, agencyId: string): Promise<AgencyAgent[]> {
  const sql = getSql();
  const rows = await sql`SELECT legacy_user_id,user_id,name,username,email,phone,staff_role,status,created_at::text
    FROM app.read_agency_staff_v3(${actorId}::uuid,${agencyId}::uuid)`;
  return rows.map((row) => ({
    id: String(row.legacy_user_id),
    name: String(row.name),
    username: String(row.username),
    email: String(row.email),
    phone: String(row.phone ?? ""),
    status: String(row.status) as AgencyAgent["status"],
    createdAt: String(row.created_at),
    staffRole: String(row.staff_role) as AgencyAgent["staffRole"],
  }));
}

export async function createAgencyAgent(input: {
  actorId: string;
  agencyId: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  staffRole?: AgencyAgent["staffRole"];
}) {
  const sql = getSql();
  const token = randomBytes(32).toString("base64url");
  const initials = input.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const rows = await sql`SELECT legacy_user_id,activation_required FROM app.provision_agency_staff_v3(
    ${input.actorId}::uuid,${input.agencyId}::uuid,${input.staffRole ?? "agent"},${input.name},${initials},
    ${input.username.trim().toLocaleLowerCase("en-US")},${input.email},${input.phone},
    ${createHash("sha256").update(token).digest("hex")},${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz)`;
  return { id: String(rows[0].legacy_user_id), activationToken: Boolean(rows[0].activation_required) ? token : null };
}

export async function removeAgencyAgent(actorId: string, agencyId: string, agentId: string) {
  const sql = getSql();
  const rows = await sql`SELECT app.remove_agency_staff_v3(${actorId}::uuid,${agencyId}::uuid,${agentId}) removed`;
  return Boolean(rows[0]?.removed);
}
