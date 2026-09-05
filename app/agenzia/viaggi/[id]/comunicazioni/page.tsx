import { redirect } from "next/navigation";
import { requirePlatformAdmin, PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureCommunications } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import CommunicationsClient from "./communications-client";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import "./communications.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    const [journey, communications, operations] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId),
      readDepartureCommunications(actor.id, id),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <CommunicationsClient
        journey={journey}
        initialCommunications={communications}
        staff={operations.staff.filter((person) => person.status === "active")}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
