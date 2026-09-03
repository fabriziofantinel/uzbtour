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
};

export async function readAgencyAgents(actorId: string, agencyId: string): Promise<AgencyAgent[]> {
  const sql = getSql();
  const rows = await sql`SELECT id,name,username,email,phone,status,created_at::text
    FROM app.read_agency_agents_v3(${actorId}::uuid,${agencyId}::uuid)`;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    username: String(row.username),
    email: String(row.email),
    phone: String(row.phone ?? ""),
    status: String(row.status) as AgencyAgent["status"],
    createdAt: String(row.created_at),
  }));
}

export async function createAgencyAgent(input: {
  actorId: string;
  agencyId: string;
  name: string;
  username: string;
  email: string;
  phone: string;
}) {
  const sql = getSql();
  const token = randomBytes(32).toString("base64url");
  const initials = input.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const rows = await sql`SELECT legacy_user_id,activation_required FROM app.provision_agency_agent_v3(
    ${input.actorId}::uuid,${input.agencyId}::uuid,${input.name},${initials},
    ${input.username.trim().toLocaleLowerCase("en-US")},${input.email},${input.phone},
    ${createHash("sha256").update(token).digest("hex")},${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz)`;
  return { id: String(rows[0].legacy_user_id), activationToken: Boolean(rows[0].activation_required) ? token : null };
}

export async function removeAgencyAgent(actorId: string, agencyId: string, agentId: string) {
  const sql = getSql();
  const rows = await sql`SELECT app.remove_agency_agent_v3(${actorId}::uuid,${agencyId}::uuid,${agentId}) removed`;
  return Boolean(rows[0]?.removed);
}
