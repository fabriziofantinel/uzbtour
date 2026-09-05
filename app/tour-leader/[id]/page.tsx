import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import {
  canOperateDeparture,
  readDepartureOperationalControl,
  readMyDepartureStaff,
} from "@/lib/platform/departure-operational-control";
import OperationalControlClient from "@/app/agenzia/viaggi/[id]/operativita/operational-control-client";

export const dynamic = "force-dynamic";

export default async function TourLeaderDeparturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const assignment = (await readMyDepartureStaff(user.nativeId)).find((item) => item.id === id);
  if (!assignment || !(await canOperateDeparture(user.nativeId, id))) redirect("/tour-leader");
  return (
    <OperationalControlClient
      departureId={id}
      initialData={await readDepartureOperationalControl(user.nativeId, id)}
      backHref="/tour-leader"
      backLabel="Le tue partenze"
      staffRole={assignment.role}
      departureTitle={assignment.title}
      primaryColor={assignment.primaryColor}
    />
  );
}
