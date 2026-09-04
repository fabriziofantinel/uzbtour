import "server-only";
import { getSql } from "@/lib/db";
export type OperationalChatScope = "trip" | "group" | "traveler" | "accompagnatore" | "guida";
export async function listOperationalMessages(input: {
  userId: string;
  departureId: string;
  scope: OperationalChatScope;
  partyId?: string | null;
  travelerId?: string | null;
}) {
  const rows =
    input.scope === "accompagnatore" || input.scope === "guida"
      ? await getSql()`SELECT id::text,sender_name,sender_role,body,created_at::text,is_mine FROM app.list_staff_operational_messages_v3(${input.userId}::uuid,${input.departureId}::uuid,${input.scope},100)`
      : await getSql()`SELECT id::text,sender_name,sender_role,body,created_at::text,is_mine FROM app.list_operational_messages_scoped_v3(${input.userId}::uuid,${input.departureId}::uuid,${input.scope},${input.partyId ?? null}::uuid,${input.travelerId ?? null}::uuid,100)`;
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
  scope: OperationalChatScope;
  partyId?: string | null;
  travelerId?: string | null;
  body: string;
  clientOperationId: string;
}) {
  const rows =
    input.scope === "accompagnatore" || input.scope === "guida"
      ? await getSql()`SELECT app.send_staff_operational_message_v3(${input.userId}::uuid,${input.departureId}::uuid,${input.scope},${input.body},${input.clientOperationId}::uuid) AS id`
      : await getSql()`SELECT app.send_operational_message_scoped_v3(${input.userId}::uuid,${input.departureId}::uuid,${input.scope},${input.partyId ?? null}::uuid,${input.travelerId ?? null}::uuid,${input.body},${input.clientOperationId}::uuid) AS id`;
  return String(rows[0].id);
}
