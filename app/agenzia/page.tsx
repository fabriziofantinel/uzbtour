import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getPlatformOverview } from "@/lib/platform/repository";
import AgencyDashboard from "./agency-dashboard";
import "./agency.css";

export const dynamic = "force-dynamic";

export default async function AgencyPage() {
  try {
    const actor = await requirePlatformAdmin();
    const overview = await getPlatformOverview(actor);
    return <AgencyDashboard initialOverview={overview} />;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
