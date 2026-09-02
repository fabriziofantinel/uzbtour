import "server-only";
import { getSql } from "@/lib/db";
export async function listOperationalMessages(input: { userId: string; departureId: string; partyId: string }) {
  const rows =
    await getSql()`SELECT id::text,sender_name,sender_role,body,created_at::text,is_mine FROM app.list_operational_messages_v3(${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,100)`;
  return rows.reverse().map((row) => ({
    id: String(row.id),
    senderName: String(row.sender_name),
    senderRole: String(row.sender_role),
    body: String(row.body),
    createdAt: String(row.created_at),
    isMine: Boolean(row.is_mine),
  }));
}
export async function sendOperationalMessage(input: {
  userId: string;
  departureId: string;
  partyId: string;
  body: string;
  clientOperationId: string;
}) {
  const rows =
    await getSql()`SELECT app.send_operational_message_v3(${input.userId},${input.departureId}::uuid,${input.partyId}::uuid,${input.body},${input.clientOperationId}::uuid) AS id`;
  return String(rows[0].id);
}
