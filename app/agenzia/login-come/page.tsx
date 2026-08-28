import { redirect } from "next/navigation";
import { requireAgencyAdminActor } from "@/lib/platform/authorization";
import { readV3AgencyImpersonationTravelers } from "@/lib/platform/v3-identity-access";
import AgencyImpersonationClient from "./agency-impersonation-client";
import "../../smf-2026.css";
import "./style.css";

export const dynamic = "force-dynamic";

export default async function AgencyImpersonationPage() {
  try {
    const actor = await requireAgencyAdminActor();
    return <AgencyImpersonationClient users={await readV3AgencyImpersonationTravelers(actor.id)} />;
  } catch { redirect("/"); }
}
