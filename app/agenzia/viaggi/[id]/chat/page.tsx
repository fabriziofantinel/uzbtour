import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requireDepartureCollaborator } from "@/lib/platform/authorization";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import AgencyOperationalChat from "./chat-client";
import { readDepartureOperationalControl, readDepartureStaffRole } from "@/lib/platform/departure-operational-control";
import "../../../../smf-2026.css";
export const dynamic = "force-dynamic";
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureCollaborator(id);
    const staffAccess = !actor.isAgencyAdmin && !actor.isSuperAdmin;
    const [data, operations, staffRole] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId, staffAccess),
      readDepartureOperationalControl(actor.nativeId, id),
      staffAccess ? readDepartureStaffRole(actor.nativeId, id) : Promise.resolve(null),
    ]);
    return (
      <AgencyOperationalChat
        actorUserId={actor.nativeId}
        data={data}
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
