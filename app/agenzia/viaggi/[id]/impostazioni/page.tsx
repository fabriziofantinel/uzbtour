import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { readDepartureInsurance } from "@/lib/platform/departure-operations";
import { getJourneyManagement } from "@/lib/platform/journey-repository";
import DepartureSettingsClient from "./settings-client";
import "../comunicazioni/communications.css";
import "./settings.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";
export default async function DepartureSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    const [journey, insurance] = await Promise.all([
      getJourneyManagement(id, actor.id, actor.nativeId),
      readDepartureInsurance(actor.nativeId, id),
    ]);
    return <DepartureSettingsClient journey={journey} initialInsurance={insurance} />;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
