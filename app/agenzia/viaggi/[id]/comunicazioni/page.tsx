import { redirect } from "next/navigation";
import { requireDepartureOperator, PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureCommunications } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import CommunicationsClient from "./communications-client";
import { readDepartureOperationalControl, readMyDepartureStaff } from "@/lib/platform/departure-operational-control";
import "./communications.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  try {
    const { id } = await params;
    const actor = await requireDepartureOperator(id);
    const scope = (await searchParams)?.scope;
    const assignment =
      actor.isAgencyAdmin || actor.isSuperAdmin
        ? null
        : (await readMyDepartureStaff(actor.nativeId)).find((person) => person.id === id);
    const isTravelerStaff = scope === "traveler-staff";
    const isGuideOrAccompagnatore = assignment?.role === "guida" || assignment?.role === "accompagnatore";
    const showOperations =
      actor.isAgencyAdmin || actor.isSuperAdmin ? true : !(isGuideOrAccompagnatore || isTravelerStaff);
    const [journey, communications, operations] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId),
      readDepartureCommunications(actor.id, id),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <CommunicationsClient
        actorUserId={actor.nativeId}
        journey={journey}
        initialCommunications={communications}
        staff={operations.staff.filter((person) => person.status === "active")}
        showOperations={showOperations}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
