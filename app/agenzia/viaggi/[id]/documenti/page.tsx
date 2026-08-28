import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getAgencyDayDocuments } from "@/lib/platform/day-documents-repository";
import DayDocumentsClient from "./day-documents-client";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";
export default async function DayDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin(); const { id } = await params;
    return <DayDocumentsClient initialData={await getAgencyDayDocuments(id, actor.id)}/>;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
