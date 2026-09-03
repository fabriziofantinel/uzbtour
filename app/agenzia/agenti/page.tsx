import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getPlatformOverview } from "@/lib/platform/repository";
import { readAgencyAgents } from "@/lib/platform/agency-agent-repository";
import AgencyAgentsClient from "./agents-client";

export const dynamic = "force-dynamic";

export default async function AgencyAgentsPage() {
  try {
    const actor = await requirePlatformAdmin();
    const overview = await getPlatformOverview(actor);
    const agencies = overview.agencies.filter((agency) => agency.role === "owner");
    if (!agencies.length) redirect("/agenzia");
    const agentsByAgency = Object.fromEntries(
      await Promise.all(agencies.map(async (agency) => [agency.id, await readAgencyAgents(actor.nativeId, agency.id)])),
    );
    return (
      <AgencyAgentsClient
        actor={overview.actor}
        agencies={agencies.map(({ id, name, primaryColor, logoUrl }) => ({ id, name, primaryColor, logoUrl }))}
        initialAgents={agentsByAgency}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
