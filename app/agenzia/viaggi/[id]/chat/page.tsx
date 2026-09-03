import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import AgencyOperationalChat from "./chat-client";
import "../../../../smf-2026.css";
export const dynamic = "force-dynamic";
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin(),
      { id } = await params;
    return <AgencyOperationalChat data={await getJourneyManagement(id, actor.id, actor.nativeId)} />;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
