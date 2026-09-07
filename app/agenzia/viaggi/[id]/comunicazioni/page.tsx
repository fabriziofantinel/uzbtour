import { redirect } from "next/navigation";
import { requireDepartureOperator, PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureCommunications } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import CommunicationsClient from "./communications-client";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import "./communications.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureOperator(id);
    const staffAccess = !actor.isAgencyAdmin && !actor.isSuperAdmin;
    const [journey, communications, operations] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId, staffAccess),
      readDepartureCommunications(actor.id, id),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <CommunicationsClient
        actorUserId={actor.nativeId}
        journey={journey}
        initialCommunications={communications}
        staff={operations.staff.filter((person) => person.status === "active")}
        showOperations
        staffView={staffAccess}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
