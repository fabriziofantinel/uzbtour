import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { createV3JourneyParty, provisionV3JourneyTraveler } from "./v3-journey-provisioning";
import { readV3JourneyManagement } from "./v3-journey-management";
import { setDeparturePartyExperienceProfile } from "./departure-operations";

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
function familyCode(name: string) {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "GRUPPO";
  return `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function getJourneyManagement(departureId: string, actorId: string, actorNativeId: string) {
  return readV3JourneyManagement(departureId, actorId, actorNativeId);
}

export async function createJourneyFamily(input: {
  departureId: string;
  agencyId: string;
  name: string;
  actorId: string;
}) {
  return createV3JourneyParty({ ...input, code: familyCode(input.name) });
}

export async function addJourneyTraveler(input: {
  agencyId: string;
  partyId: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  birthDate?: string;
  role: "organizer" | "member";
  actorId: string;
}) {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  const normalizedUsername = input.username.trim().toLocaleLowerCase("en-US");
  const token = randomBytes(32).toString("base64url");
  const result = await provisionV3JourneyTraveler({
    ...input,
    username: normalizedUsername,
    email: normalizedEmail,
    initials: initialsFor(input.name),
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return {
    travelerId: result.travelerId,
    activationToken: result.activationRequired ? token : null,
  };
}

export async function updateJourneyGroupCompetition(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  travelerId: string;
  enabled: boolean;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.update_journey_traveler_competition(
    ${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,
    ${input.partyId}::uuid,${input.travelerId}::uuid,${input.enabled}
  ) AS updated`;
  return Boolean(rows[0]?.updated);
}

export async function setJourneyGroupLeader(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  travelerId: string;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.set_journey_party_leader(
    ${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,
    ${input.partyId}::uuid,${input.travelerId}::uuid
  ) AS updated`;
  return Boolean(rows[0]?.updated);
}

export async function setMinorImageConsent(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  travelerId: string;
  decision: "granted" | "denied" | "withdrawn";
}) {
  const rows =
    await getSql()`SELECT app.set_minor_image_consent_v3(${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid,${input.travelerId}::uuid,${input.decision},'') consent_id`;
  return String(rows[0]?.consent_id || "");
}

export async function removeJourneyTraveler(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  travelerId: string;
}) {
  const rows =
    await getSql()`SELECT app.remove_journey_traveler_v3(${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid,${input.travelerId}::uuid) removed`;
  return Boolean(rows[0]?.removed);
}
export async function deleteJourneyGroup(input: {
  actorId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
}) {
  const rows =
    await getSql()`SELECT app.delete_empty_journey_party_v3(${input.actorId},${input.agencyId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid) deleted`;
  return Boolean(rows[0]?.deleted);
}

export async function updateJourneyGroupExperienceProfile(input: {
  actorId: string;
  departureId: string;
  partyId: string;
  profile: "essential" | "standard" | "complete";
}) {
  await setDeparturePartyExperienceProfile(input);
}
