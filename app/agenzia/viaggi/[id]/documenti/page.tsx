import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getAgencyDayDocuments } from "@/lib/platform/day-documents-repository";
import DayDocumentsClient from "./day-documents-client";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";
export default async function DayDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    const [data, operations] = await Promise.all([
      getAgencyDayDocuments(id, actor.id, actor.nativeId),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <DayDocumentsClient initialData={data} staff={operations.staff.filter((person) => person.status === "active")} />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
