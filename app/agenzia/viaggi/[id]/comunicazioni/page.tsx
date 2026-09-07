import { redirect } from "next/navigation";
import { requireDepartureCollaborator, PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureCommunications } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import CommunicationsClient from "./communications-client";
import { readDepartureOperationalControl, readDepartureStaffRole } from "@/lib/platform/departure-operational-control";
import "./communications.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureCollaborator(id);
    const staffAccess = !actor.isAgencyAdmin && !actor.isSuperAdmin;
    const [journey, communications, operations, staffRole] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId, staffAccess),
      readDepartureCommunications(actor.id, id, actor.nativeId),
      readDepartureOperationalControl(actor.nativeId, id),
      staffAccess ? readDepartureStaffRole(actor.nativeId, id) : Promise.resolve(null),
    ]);
    return (
      <CommunicationsClient
        actorUserId={actor.nativeId}
        journey={journey}
        initialCommunications={communications}
        staff={operations.staff.filter((person) => person.status === "active")}
        showOperations
        staffView={staffAccess}
        staffRole={staffRole}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
