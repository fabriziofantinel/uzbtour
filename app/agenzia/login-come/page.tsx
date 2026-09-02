import { redirect } from "next/navigation";
import { requireAgencyAdminActor } from "@/lib/platform/authorization";
import { readV3AgencyImpersonationTravelers } from "@/lib/platform/v3-identity-access";
import AgencyImpersonationClient from "./agency-impersonation-client";
import { getPlatformOverview } from "@/lib/platform/repository";
import "../../smf-2026.css";
import "./style.css";

export const dynamic = "force-dynamic";

export default async function AgencyImpersonationPage() {
  try {
    const actor = await requireAgencyAdminActor();
    const [users, overview] = await Promise.all([
      readV3AgencyImpersonationTravelers(actor.id),
      getPlatformOverview(actor),
    ]);
    const agency = overview.agencies[0];
    return <AgencyImpersonationClient users={users} primaryColor={agency?.primaryColor || "#247A6B"} />;
  } catch {
    redirect("/");
  }
}
