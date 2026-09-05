import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { canOperateDeparture, readMyDepartureStaff } from "@/lib/platform/departure-operational-control";

export const dynamic = "force-dynamic";

export default async function TourLeaderDeparturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const assignment = (await readMyDepartureStaff(user.nativeId)).find((item) => item.id === id);
  if (!assignment || !(await canOperateDeparture(user.nativeId, id))) redirect("/tour-leader");
  const rolePath = `/agenzia/viaggi/${id}/programma`;
  const roleHint = assignment.role === "accompagnatore" || assignment.role === "guida" ? "?scope=traveler-staff" : "";
  if (roleHint) {
    return redirect(`${rolePath}${roleHint}`);
  }
  return redirect(rolePath);
}
