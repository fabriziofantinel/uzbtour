import { getAgencyRegistry } from "@/lib/platform/superadmin-repository";
import AgencyRegistry from "./agency-registry";

export default async function AgenciesPage() {
  return <AgencyRegistry initialAgencies={await getAgencyRegistry()}/>;
}
