import { getAgencyRegistry } from "@/lib/platform/superadmin-repository";
import AgencyRegistry from "./agency-registry";
import { requireSuperAdmin } from "@/lib/platform/authorization";

export default async function AgenciesPage() {
  const actor = await requireSuperAdmin();
  return <AgencyRegistry initialAgencies={await getAgencyRegistry(actor.id)} />;
}
