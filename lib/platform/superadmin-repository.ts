import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";
import { readV3AgencyRegistry, readV3ImpersonationUsers, readV3SuperadminSummary } from "./v3-superadmin-read";
import { createV3PlatformAgencyWithOwner, provisionV3PlatformAgencyAgent, replaceV3PlatformAgencyOwner, updateV3PlatformAgencyBranding, updateV3PlatformAgencyStatus } from "./v3-superadmin-mutations";
import { getJobQueue } from "./job-queue";
import { createHash, randomBytes } from "node:crypto";

export type SuperadminSummary = {
  agencies: number;
  trips: number;
  travelers: number;
};

export type AgencyAgent = {
  id: string;
  name: string;
  username: string;
  initials: string;
  email: string;
  phone: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: string;
};

export type AgencyRegistryItem = {
  id: string;
  slug: string;
  name: string;
  status: string;
  legalName: string;
  vatNumber: string;
  taxCode: string;
  registeredAddress: string;
  registeredCity: string;
  registeredPostalCode: string;
  registeredProvince: string;
  registeredCountry: string;
  pec: string;
  sdiCode: string;
  phone: string;
  email: string;
  website: string;
  referenceName: string;
  referenceEmail: string;
  referencePhone: string;
  primaryColor: string;
  logoUrl: string;
  tripCount: number;
  travelerCount: number;
  ongoingTripCount: number;
  upcomingTripCount: number;
  agents: AgencyAgent[];
};

export type ImpersonationUser = {
  id: string;
  name: string;
  username: string;
  initials: string;
  email: string;
  phone: string;
  status: string;
  platformRole: "superadmin" | "user";
  agencyNames: string[];
  agencyRoles: string[];
  isTraveler: boolean;
};

function agencySlug(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "agenzia";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function getSuperadminSummary(actorId: string): Promise<SuperadminSummary> {
  return readV3SuperadminSummary(actorId);
}

export async function getAgencyRegistry(actorId: string): Promise<AgencyRegistryItem[]> {
  return readV3AgencyRegistry(actorId);
}

export async function getImpersonationUsers(actorId: string): Promise<ImpersonationUser[]> {
  return readV3ImpersonationUsers(actorId);
}

export async function createAgency(input: {
  actorId: string;
  name: string;
  legalName?: string;
  vatNumber?: string;
  taxCode?: string;
  registeredAddress?: string;
  registeredCity?: string;
  registeredPostalCode?: string;
  registeredProvince?: string;
  registeredCountry?: string;
  pec?: string;
  sdiCode?: string;
  phone?: string;
  email?: string;
  website?: string;
  referenceName: string;
  referenceUsername: string;
  referenceEmail: string;
  referencePhone: string;
  primaryColor?: string;
  logoUrl?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const result = await createV3PlatformAgencyWithOwner({
    ...input,
    referenceUsername: input.referenceUsername.trim().toLocaleLowerCase("en-US"),
    referenceInitials: initialsFor(input.referenceName),
    slug: agencySlug(input.name),
    tokenHash:createHash("sha256").update(token).digest("hex"),
    expiresAt:new Date(Date.now()+14*24*60*60*1000).toISOString(),
  });
  return { id:result.agencyId,activationToken:result.activationRequired?token:null };
}

export async function updateAgencyBranding(input: {
  actorId: string;
  agencyId: string;
  primaryColor: string;
  logoUrl: string;
}) {
  await updateV3PlatformAgencyBranding(input);
}

export async function updateAgencyStatus(input:{actorId:string;agencyId:string;status:"trial"|"active"|"suspended"}){
  await updateV3PlatformAgencyStatus(input);
}

export async function replaceAgencyOwner(input:{actorId:string;agencyId:string;name:string;username:string;email:string;phone:string}){
  const token=randomBytes(32).toString("base64url");
  const result=await replaceV3PlatformAgencyOwner({
    ...input,username:input.username.trim().toLocaleLowerCase("en-US"),initials:initialsFor(input.name),
    tokenHash:createHash("sha256").update(token).digest("hex"),
    expiresAt:new Date(Date.now()+14*24*60*60*1000).toISOString(),
  });
  return {id:result.id,activationToken:result.activationRequired?token:null};
}

export async function updateAgencyOwnerContact(input:{actorId:string;agencyId:string;email:string;phone:string}){
  const {updateV3PlatformAgencyOwnerContact}=await import("./v3-superadmin-mutations");
  await updateV3PlatformAgencyOwnerContact(input);
}

export async function updateAgencyDetails(input:{actorId:string;agencyId:string;data:Record<string,string>}){
  const {updateV3PlatformAgencyDetails}=await import("./v3-superadmin-mutations");await updateV3PlatformAgencyDetails(input);
}

export async function isUsernameAvailable(actorId:string,username:string){
  const {readV3UsernameAvailability}=await import("./v3-superadmin-mutations");
  return readV3UsernameAvailability(actorId,username.trim().toLocaleLowerCase("en-US"));
}

export async function requestAgencyDeletion(input: { actorId: string; agencyId: string; reason: string }) {
  const sql = getSql();
  const rows=await sql`SELECT job_id::text,agency_name,status,phase
    FROM app.request_agency_deletion_v3(${input.actorId},${input.agencyId},${input.reason})`;
  if(!rows[0]) throw new PlatformRequestError("Richiesta di eliminazione non registrata");
  const deletionJobId=String(rows[0].job_id);
  const queueJob=await getJobQueue().enqueue({
    actorId:input.actorId,agencyId:input.agencyId,type:"agency.delete",
    payload:{deletionJobId},idempotencyKey:`agency-delete:${deletionJobId}`,
  });
  return { deletionJobId,queueJobId:queueJob.id,agencyName:String(rows[0].agency_name),status:String(rows[0].status),phase:String(rows[0].phase) };
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "").join("");
}

export async function createAgencyAgent(input: {
  actorId: string;
  agencyId: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  role: "admin" | "editor" | "viewer";
}) {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  const normalizedUsername = input.username.trim().toLocaleLowerCase("en-US");
  const token = randomBytes(32).toString("base64url");
  const result = await provisionV3PlatformAgencyAgent({
    ...input,email:normalizedEmail,username:normalizedUsername,initials:initialsFor(input.name),
    tokenHash:createHash("sha256").update(token).digest("hex"),
    expiresAt:new Date(Date.now()+14*24*60*60*1000).toISOString(),
  });
  return { id:result.id,activationToken:result.activationRequired?token:null };
}
