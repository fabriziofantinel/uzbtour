import "server-only";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

type Row = Record<string, unknown>;

export type DepartureCommunication = {
  id: string;
  title: string;
  summary: string;
  severity: "information" | "important" | "urgent";
  requiresAcknowledgement: boolean;
  acknowledgeBy: string | null;
  audiencePartyIds: string[];
  publishedAt: string;
  recipientCount: number;
  readCount: number;
  unreachableCount: number;
  overdue: boolean;
  closedAt: string | null;
  closureNote: string | null;
  audienceKind: "traveler" | "staff";
  staffRole: string | null;
  isRecipient: boolean;
  readAt: string | null;
  canClose: boolean;
};

export async function readDepartureCommunications(
  actorId: string,
  departureId: string,
  actorNativeId?: string,
): Promise<DepartureCommunication[]> {
  const sql = getSql();
  const [travelerRows, staffRows] = await Promise.all([
    actorNativeId
      ? sql`SELECT * FROM app.read_departure_communications_native_v3(${actorNativeId}::uuid,${departureId}::uuid)`
      : sql`SELECT * FROM app.read_departure_communications_v3(${actorId},${departureId}::uuid)`,
    actorNativeId
      ? sql`SELECT * FROM app.read_staff_departure_communications_v3(${actorNativeId}::uuid,${departureId}::uuid)`
      : Promise.resolve([]),
  ]);
  const travelerCommunications = travelerRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    severity: String(row.severity) as "information" | "important" | "urgent",
    requiresAcknowledgement: Boolean(row.requires_acknowledgement),
    acknowledgeBy: row.acknowledge_by ? String(row.acknowledge_by) : null,
    audiencePartyIds: Array.isArray(row.audience_party_ids) ? row.audience_party_ids.map(String) : [],
    publishedAt: String(row.published_at),
    recipientCount: Number(row.recipient_count),
    readCount: Number(row.read_count),
    unreachableCount: Number(row.unreachable_count),
    overdue: Boolean(row.overdue),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closureNote: row.closure_note ? String(row.closure_note) : null,
    audienceKind: "traveler" as const,
    staffRole: null,
    isRecipient: false,
    readAt: null,
    canClose: true,
  }));
  const staffCommunications = staffRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    severity: String(row.severity) as "information" | "important" | "urgent",
    requiresAcknowledgement: Boolean(row.requires_acknowledgement),
    acknowledgeBy: row.acknowledge_by ? String(row.acknowledge_by) : null,
    audiencePartyIds: [] as string[],
    publishedAt: String(row.published_at),
    recipientCount: Number(row.recipient_count),
    readCount: Number(row.read_count),
    unreachableCount: 0,
    overdue: Boolean(row.overdue),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closureNote: row.closure_note ? String(row.closure_note) : null,
    audienceKind: "staff" as const,
    staffRole: String(row.staff_role),
    isRecipient: Boolean(row.is_recipient),
    readAt: row.read_at ? String(row.read_at) : null,
    canClose: Boolean(row.can_close),
  }));
  return [...travelerCommunications, ...staffCommunications].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
}

export async function readDepartureCommunicationRecipients(
  actorId: string,
  actorNativeId: string,
  noticeId: string,
  audienceKind: "traveler" | "staff",
) {
  const rows =
    audienceKind === "staff"
      ? await getSql()`SELECT * FROM app.read_staff_communication_recipients_v3(${actorNativeId}::uuid,${noticeId}::uuid)`
      : await getSql()`SELECT * FROM app.read_departure_communication_recipients_native_v3(${actorNativeId}::uuid,${noticeId}::uuid)`;
  return rows.map((row) => ({
    recipientId: String(row.traveler_id ?? row.user_id),
    travelerId: row.traveler_id ? String(row.traveler_id) : null,
    partyId: row.party_id ? String(row.party_id) : null,
    name: String(row.display_name),
    email: String(row.email || ""),
    readAt: row.read_at ? String(row.read_at) : null,
    reachableByPush: Boolean(row.reachable_by_push),
  }));
}

export async function publishDepartureCommunication(input: {
  actorId: string;
  actorNativeId: string;
  departureId: string;
  title: string;
  summary: string;
  severity: "information" | "important" | "urgent";
  requiresAcknowledgement: boolean;
  acknowledgeBy: string | null;
  audiencePartyIds: string[];
  audienceTravelerIds: string[];
  clientOperationId: string;
}) {
  const rows = await getSql()`SELECT app.publish_departure_communication_native_v3(
    ${input.actorNativeId}::uuid,${input.departureId}::uuid,${input.title},${input.summary},${input.severity},
    ${input.requiresAcknowledgement},${input.acknowledgeBy}::timestamptz,${input.audiencePartyIds}::uuid[],
    ${input.audienceTravelerIds}::uuid[],${input.clientOperationId}::uuid)::text id`;
  if (!rows[0]?.id) throw new PlatformRequestError("Comunicazione non pubblicata");
  return String(rows[0].id);
}

export async function acknowledgeStaffCommunication(actorNativeId: string, noticeId: string, operationId: string) {
  const rows = await getSql()`SELECT app.acknowledge_staff_communication_v3(
    ${actorNativeId}::uuid,${noticeId}::uuid,${operationId}::uuid) acknowledged`;
  return Boolean(rows[0]?.acknowledged);
}

export async function publishStaffDepartureCommunication(input: {
  actorId: string;
  departureId: string;
  staffRole: "accompagnatore" | "guida";
  staffUserIds: string[];
  title: string;
  summary: string;
  severity: "information" | "important" | "urgent";
  requiresAcknowledgement: boolean;
  acknowledgeBy: string | null;
  clientOperationId: string;
}) {
  const rows = await getSql()`SELECT app.publish_selected_staff_communication_v3(
    ${input.actorId}::uuid,${input.departureId}::uuid,${input.staffRole},${input.title},${input.summary},${input.severity},
    ${input.requiresAcknowledgement},${input.acknowledgeBy}::timestamptz,${input.clientOperationId}::uuid,${input.staffUserIds}::uuid[])::text id`;
  if (!rows[0]?.id) throw new PlatformRequestError("Comunicazione al personale non pubblicata");
  return String(rows[0].id);
}

export async function closeDepartureCommunication(
  actorNativeId: string,
  noticeId: string,
  note: string,
  audienceKind: "traveler" | "staff",
) {
  const rows =
    audienceKind === "staff"
      ? await getSql()`SELECT app.close_staff_communication_v3(${actorNativeId}::uuid,${noticeId}::uuid,${note}) closed`
      : await getSql()`SELECT app.close_departure_communication_native_v3(${actorNativeId}::uuid,${noticeId}::uuid,${note}) closed`;
  if (!Boolean(rows[0]?.closed)) throw new PlatformRequestError("Comunicazione non chiusa");
}

export async function recordCommunicationReminder(input: {
  actorId: string;
  actorNativeId: string;
  noticeId: string;
  travelerId: string;
  channel: "push" | "email" | "group_leader";
  outcome: "sent" | "unreachable" | "failed" | "reported";
  details?: Record<string, unknown>;
}) {
  const rows = await getSql()`SELECT app.record_change_notice_reminder_native_v3(
    ${input.actorNativeId}::uuid,${input.noticeId}::uuid,${input.travelerId}::uuid,${input.channel},${input.outcome},
    ${JSON.stringify(input.details ?? {})}::jsonb)::text id`;
  return String(rows[0]?.id || "");
}

export async function readDepartureInsurance(actorId: string, departureId: string) {
  const rows = await getSql()`SELECT * FROM app.read_departure_insurance_v3(${actorId},${departureId}::uuid)`;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    providerName: String(row.provider_name),
    productName: String(row.product_name),
    policyNumber: String(row.policy_number),
    assistancePhone: String(row.assistance_phone),
    validFrom: String(row.valid_from),
    validTo: String(row.valid_to),
    guarantees: Array.isArray(row.guarantees) ? row.guarantees : [],
    documentId: row.document_id ? String(row.document_id) : null,
    documentTitle: row.document_title ? String(row.document_title) : null,
  };
}

export async function readDepartureInsuranceScoped(input: {
  actorNativeId: string;
  departureId: string;
  audienceScope: "trip" | "group" | "traveler";
  partyId: string | null;
  travelerId: string | null;
}) {
  const rows = await getSql()`SELECT * FROM app.read_departure_insurance_scoped_v3(
    ${input.actorNativeId}::uuid,${input.departureId}::uuid,${input.audienceScope},${input.partyId}::uuid,${input.travelerId}::uuid)`;
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    providerName: String(row.provider_name),
    productName: String(row.product_name),
    policyNumber: String(row.policy_number),
    assistancePhone: String(row.assistance_phone),
    validFrom: String(row.valid_from),
    validTo: String(row.valid_to),
    guarantees: Array.isArray(row.guarantees) ? row.guarantees : [],
    documentId: row.document_id ? String(row.document_id) : null,
    documentTitle: row.document_title ? String(row.document_title) : null,
  };
}

export async function saveDepartureInsurance(input: {
  actorNativeId: string;
  departureId: string;
  providerName: string;
  productName: string;
  policyNumber: string;
  assistancePhone: string;
  validFrom: string;
  validTo: string;
  guarantees: Array<{ label: string; status: "included" | "excluded" | "not_indicated"; notes: string }>;
  documentId: string | null;
  audienceScope: "trip" | "group" | "traveler";
  partyId: string | null;
  travelerId: string | null;
}) {
  const rows = await getSql()`SELECT app.save_departure_insurance_scoped_v3(
    ${input.actorNativeId}::uuid,${input.departureId}::uuid,${input.audienceScope},${input.partyId}::uuid,${input.travelerId}::uuid,${input.providerName},${input.productName},${input.policyNumber},
    ${input.assistancePhone},${input.validFrom}::date,${input.validTo}::date,${JSON.stringify(input.guarantees)}::jsonb,
    ${input.documentId}::uuid)::text id`;
  return String(rows[0]?.id || "");
}

export async function setDepartureExperienceProfile(
  actorId: string,
  departureId: string,
  profile: "essential" | "standard" | "complete",
) {
  const rows =
    await getSql()`SELECT app.set_departure_experience_profile_v3(${actorId},${departureId}::uuid,${profile}) updated`;
  if (!Boolean(rows[0]?.updated)) throw new PlatformRequestError("Profilo esperienza non aggiornato");
}

export async function readDepartureExperienceProfile(actorId: string, departureId: string) {
  const rows = await getSql()`SELECT app.read_departure_experience_profile_v3(${actorId},${departureId}::uuid) profile`;
  const profile = String(rows[0]?.profile || "complete");
  return profile === "essential" || profile === "standard" ? profile : "complete";
}

export async function registerDepartureInsuranceDocument(input: {
  actorNativeId: string;
  departureId: string;
  provider: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  audienceScope: "trip" | "group" | "traveler";
  partyId: string | null;
  travelerId: string | null;
}) {
  const mediaId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const rows = await getSql()`SELECT app.register_departure_insurance_document_scoped_v3(
    ${input.actorNativeId}::uuid,${input.departureId}::uuid,${input.audienceScope},${input.partyId}::uuid,${input.travelerId}::uuid,${mediaId}::uuid,${documentId}::uuid,${input.provider},${input.bucket},
    ${input.objectKey},${input.originalName},${input.contentType},${input.sizeBytes})::text id`;
  if (!rows[0]?.id) throw new PlatformRequestError("Documento assicurativo non registrato");
  return documentId;
}

export async function setDeparturePartyExperienceProfile(input: {
  actorNativeId: string;
  departureId: string;
  partyId: string;
  profile: "essential" | "standard" | "complete";
}) {
  const rows =
    await getSql()`SELECT app.set_departure_party_experience_profile_v3(${input.actorNativeId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid,${input.profile}) updated`;
  if (!Boolean(rows[0]?.updated)) throw new PlatformRequestError("Profilo esperienza del gruppo non aggiornato");
}
