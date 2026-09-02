import { redirect } from "next/navigation";
import { requirePlatformAdmin, PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureCommunications } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import CommunicationsClient from "./communications-client";
import "./communications.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    const [journey, communications] = await Promise.all([
      getJourneyManagement(id, actor.id),
      readDepartureCommunications(actor.id, id),
    ]);
    return <CommunicationsClient journey={journey} initialCommunications={communications} />;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
