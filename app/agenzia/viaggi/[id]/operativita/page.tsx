import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requireDepartureOperator } from "@/lib/platform/authorization";
import { readDepartureOperationalControl, readMyDepartureStaff } from "@/lib/platform/departure-operational-control";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import OperationalControlClient from "./operational-control-client";

export const dynamic = "force-dynamic";
export default async function OperationalControlPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureOperator(id);
    const staffAccess = !actor.isAgencyAdmin && !actor.isSuperAdmin;
    const [journey, initialData, assignments] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId, staffAccess),
      readDepartureOperationalControl(actor.nativeId, id),
      staffAccess ? readMyDepartureStaff(actor.nativeId) : Promise.resolve([]),
    ]);
    const assignment = assignments.find((item) => item.id === id);
    return (
      <OperationalControlClient
        departureId={id}
        journey={journey}
        initialData={initialData}
        staffRole={assignment?.role}
        departureTitle={journey.journey.title}
        primaryColor={journey.journey.agencyPrimaryColor}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
