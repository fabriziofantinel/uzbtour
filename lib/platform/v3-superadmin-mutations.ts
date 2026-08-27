import "server-only";
import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

export async function createV3PlatformAgency(input: Record<string, string> & { actorId: string }) {
  const sql=getSql();const branding=JSON.stringify({primaryColor:input.primaryColor||"#247A6B",logoUrl:input.logoUrl||""});
  const rows=await sql`SELECT app.create_platform_agency(${input.actorId},${input.slug},${input.name},
    ${input.legalName||""},${input.vatNumber||""},${input.taxCode||""},${input.registeredAddress||""},
    ${input.registeredCity||""},${input.registeredPostalCode||""},${input.registeredProvince||""},
    ${input.registeredCountry||""},${input.pec||""},${input.sdiCode||""},${input.phone||""},
    ${input.email||""},${input.website||""},${input.referenceName},${input.referenceEmail||""},
    ${input.referencePhone||""},${branding}::jsonb)::text id`;
  return String(rows[0].id);
}

export async function updateV3PlatformAgencyBranding(input:{actorId:string;agencyId:string;primaryColor:string;logoUrl:string}){
  const sql=getSql();const rows=await sql`SELECT app.update_platform_agency_branding(
    ${input.actorId},${input.agencyId}::uuid,${input.primaryColor},${input.logoUrl}) updated`;
  if(!rows[0]?.updated)throw new PlatformRequestError("Agenzia non trovata");
}

export async function provisionV3PlatformAgencyAgent(input:{actorId:string;agencyId:string;name:string;initials:string;email:string;phone:string;role:"admin"|"editor"|"viewer"}){
  const sql=getSql();const rows=await sql`SELECT app.provision_platform_agency_agent(
    ${input.actorId},${input.agencyId}::uuid,${input.name},${input.initials},${input.email},${input.phone},${input.role}) id`;
  return String(rows[0].id);
}
