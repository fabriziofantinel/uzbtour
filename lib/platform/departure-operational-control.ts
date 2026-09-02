import "server-only";
import { getSql } from "@/lib/db";

export async function canOperateDeparture(actorId: string, departureId: string) {
  const rows = await getSql()`SELECT app.is_departure_operator_v3(${actorId},${departureId}::uuid) allowed`;
  return Boolean(rows[0]?.allowed);
}

export async function readDepartureOperationalControl(actorId: string, departureId: string) {
  const [rows, alerts] = await Promise.all([
    getSql()`SELECT * FROM app.list_departure_operations_v3(${actorId},${departureId}::uuid)`,
    getSql()`SELECT * FROM app.list_operational_alerts_v3(${actorId},${departureId}::uuid)`,
  ]);
  return {
    staff: rows.filter((row) => row.kind === "staff").map((row) => ({ id: String(row.id), name: String(row.name) })),
    eligibleStaff: rows
      .filter((row) => row.kind === "eligible_staff")
      .map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.detail) })),
    days: rows.filter((row) => row.kind === "day").map((row) => ({ id: String(row.id), label: String(row.name) })),
    travelers: rows
      .filter((row) => row.kind === "traveler")
      .map((row) => ({
        id: String(row.traveler_id),
        partyId: String(row.party_id),
        name: String(row.name),
        group: String(row.detail),
      })),
    attendance: rows
      .filter((row) => row.kind === "attendance")
      .map((row) => ({
        id: String(row.id),
        dayId: String(row.day_id),
        travelerId: String(row.traveler_id),
        status: String(row.status),
        note: String(row.detail || ""),
      })),
    alerts: alerts.map((row) => ({
      id: String(row.id),
      travelerId: String(row.traveler_id),
      travelerName: String(row.traveler_name),
      summary: String(row.alert_summary),
      instructions: String(row.assistance_instructions),
      expiresAt: String(row.expires_at),
    })),
  };
}

export async function assignTourLeader(actorId: string, departureId: string, userId: string) {
  const rows = await getSql()`SELECT app.assign_tour_leader_v3(${actorId},${departureId}::uuid,${userId})::text id`;
  return String(rows[0]?.id || "");
}

export async function recordAttendance(input: {
  actorId: string;
  dayId: string;
  travelerId: string;
  status: "present" | "absent" | "excused";
  note: string;
}) {
  const rows =
    await getSql()`SELECT app.record_departure_attendance_v3(${input.actorId},${input.dayId}::uuid,${input.travelerId}::uuid,${input.status},${input.note})::text id`;
  return String(rows[0]?.id || "");
}

export async function saveOperationalAlert(input: {
  actorId: string;
  departureId: string;
  travelerId: string;
  summary: string;
  instructions: string;
  consent: boolean;
}) {
  const rows =
    await getSql()`SELECT app.save_operational_alert_v3(${input.actorId},${input.departureId}::uuid,${input.travelerId}::uuid,${input.summary},${input.instructions},${input.consent})::text id`;
  return String(rows[0]?.id || "");
}
