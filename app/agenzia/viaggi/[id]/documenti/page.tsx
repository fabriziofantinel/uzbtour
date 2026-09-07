import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requireDepartureOperator } from "@/lib/platform/authorization";
import { getAgencyDayDocuments } from "@/lib/platform/day-documents-repository";
import DayDocumentsClient from "./day-documents-client";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";
export default async function DayDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureOperator(id);
    const staffAccess = !actor.isAgencyAdmin && !actor.isSuperAdmin;
    const [data, operations] = await Promise.all([
      getAgencyDayDocuments(id, actor.id, actor.nativeId, staffAccess),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <DayDocumentsClient
        actorUserId={actor.nativeId}
        initialData={data}
        staff={operations.staff.filter((person) => person.status === "active")}
        showOperations
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
