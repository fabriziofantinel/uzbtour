import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import OperationalControlClient from "./operational-control-client";

export const dynamic = "force-dynamic";
export default async function OperationalControlPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    const journey = await getJourneyManagement(id, actor.id, actor.nativeId);
    return (
      <OperationalControlClient
        departureId={id}
        journey={journey}
        initialData={await readDepartureOperationalControl(actor.nativeId, id)}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
