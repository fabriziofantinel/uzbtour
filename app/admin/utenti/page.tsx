import { requireSuperAdmin } from "@/lib/platform/authorization";
import { getImpersonationUsers } from "@/lib/platform/superadmin-repository";
import ImpersonationRegistry from "./impersonation-registry";

export default async function UsersPage() {
  const actor = await requireSuperAdmin();
  return <ImpersonationRegistry initialUsers={await getImpersonationUsers(actor.id)}/>;
}
