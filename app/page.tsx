import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.isSuperAdmin) redirect("/admin");
  if (user.isAgencyAdmin) redirect("/agenzia");
  if (user.isTourLeader) redirect("/tour-leader");
  redirect("/viaggio");
}
