import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requireDepartureOperator } from "@/lib/platform/authorization";
import { getAgencyDayDocuments } from "@/lib/platform/day-documents-repository";
import DayDocumentsClient from "./day-documents-client";
import { readDepartureOperationalControl, readMyDepartureStaff } from "@/lib/platform/departure-operational-control";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";
export default async function DayDocumentsPage({
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
    const assignment = actor.isAgencyAdmin || actor.isSuperAdmin
      ? null
      : (await readMyDepartureStaff(actor.nativeId)).find((person) => person.id === id);
    const isTravelerStaff = scope === "traveler-staff";
    const showOperations =
      actor.isAgencyAdmin || actor.isSuperAdmin
        ? true
        : !(isTravelerStaff || assignment?.role === "guida" || assignment?.role === "accompagnatore");
    const [data, operations] = await Promise.all([
      getAgencyDayDocuments(id, actor.id, actor.nativeId),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <DayDocumentsClient
        actorUserId={actor.nativeId}
        initialData={data}
        staff={operations.staff.filter((person) => person.status === "active")}
        showOperations={showOperations}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
