import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import JourneyTravelers from "./travelers-client";

export const dynamic = "force-dynamic";
export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    return <JourneyTravelers initialData={await getJourneyManagement(id, actor.id)}/>;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
