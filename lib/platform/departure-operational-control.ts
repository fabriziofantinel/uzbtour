import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

export async function canOperateDeparture(actorId: string, departureId: string) {
  const rows = await getSql()`SELECT app.is_departure_operator_v3(${actorId},${departureId}::uuid) allowed`;
  return Boolean(rows[0]?.allowed);
}

export async function readMyTourLeaderDepartures(actorUserId: string) {
  const rows = await getSql()`SELECT * FROM app.list_my_tour_leader_departures_v3(${actorUserId}::uuid)`;
  return rows.map((row) => ({
    id: String(row.departure_id),
    title: String(row.title),
    agencyName: String(row.agency_name),
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
    validFrom: String(row.valid_from),
    validUntil: String(row.valid_until),
  }));
}

export async function readDepartureOperationalControl(actorUserId: string, departureId: string) {
  const [rows, alerts] = await Promise.all([
    getSql()`SELECT * FROM app.list_departure_operations_v3(${actorUserId}::uuid,${departureId}::uuid)`,
    getSql()`SELECT * FROM app.list_operational_alerts_v3(${actorUserId}::uuid,${departureId}::uuid)`,
  ]);
  return {
    staff: rows
      .filter((row) => row.kind === "staff")
      .map((row) => ({
        id: String(row.id),
        userId: String(row.traveler_id),
        name: String(row.name),
        role: String(row.detail),
        status: String(row.status),
      })),
    eligibleStaff: rows
      .filter((row) => row.kind === "eligible_staff")
      .map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.detail) })),
    days: rows.filter((row) => row.kind === "day").map((row) => ({ id: String(row.id), label: String(row.name) })),
    staffDayAssignments: rows
      .filter((row) => row.kind === "staff_day")
      .map((row) => ({ assignmentId: String(row.id), dayId: String(row.day_id) })),
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

export async function assignDepartureStaffDays(input: {
  actorUserId: string;
  departureId: string;
  userId: string;
  role: "agent" | "accompagnatore" | "guida";
  dayIds: string[];
}) {
  const rows = await getSql()`SELECT app.assign_departure_staff_days_v3(
    ${input.actorUserId}::uuid,${input.departureId}::uuid,${input.userId}::uuid,
    ${input.role},${input.dayIds}::uuid[])::text id`;
  return String(rows[0]?.id || "");
}

export async function assignTourLeader(
  actorUserId: string,
  departureId: string,
  userId: string,
  validFrom: string,
  validUntil: string,
) {
  const rows =
    await getSql()`SELECT app.assign_tour_leader_period_v3(${actorUserId}::uuid,${departureId}::uuid,${userId}::uuid,${validFrom}::timestamptz,${validUntil}::timestamptz)::text id`;
  return String(rows[0]?.id || "");
}

export async function inviteTourLeader(input: {
  actorUserId: string;
  departureId: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  validFrom: string;
  validUntil: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const initials = input.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const rows = await getSql()`SELECT legacy_user_id,activation_required,assignment_id::text
    FROM app.provision_departure_tour_leader_v3(
      ${input.actorUserId}::uuid,${input.departureId}::uuid,${input.name},${initials},
      ${input.username.trim().toLocaleLowerCase("en-US")},${input.email},${input.phone},
      ${createHash("sha256").update(token).digest("hex")},
      ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz,
      ${input.validFrom}::timestamptz,${input.validUntil}::timestamptz)`;
  return {
    userId: String(rows[0]?.legacy_user_id || ""),
    assignmentId: String(rows[0]?.assignment_id || ""),
    activationToken: Boolean(rows[0]?.activation_required) ? token : null,
  };
}

export async function revokeTourLeader(actorUserId: string, departureId: string, assignmentId: string, reason: string) {
  const rows =
    await getSql()`SELECT app.revoke_tour_leader_v3(${actorUserId}::uuid,${departureId}::uuid,${assignmentId}::uuid,${reason}) revoked`;
  return Boolean(rows[0]?.revoked);
}

export async function recordAttendance(input: {
  actorUserId: string;
  dayId: string;
  travelerId: string;
  status: "present" | "absent" | "excused";
  note: string;
}) {
  const rows =
    await getSql()`SELECT app.record_departure_attendance_v3(${input.actorUserId}::uuid,${input.dayId}::uuid,${input.travelerId}::uuid,${input.status},${input.note})::text id`;
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
