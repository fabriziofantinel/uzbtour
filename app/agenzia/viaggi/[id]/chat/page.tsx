import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import AgencyOperationalChat from "./chat-client";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import "../../../../smf-2026.css";
export const dynamic = "force-dynamic";
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin(),
      { id } = await params;
    const [data, operations] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId),
      readDepartureOperationalControl(actor.nativeId, id),
    ]);
    return (
      <AgencyOperationalChat data={data} staff={operations.staff.filter((person) => person.status === "active")} />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
