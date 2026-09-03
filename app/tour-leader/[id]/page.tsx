import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { canOperateDeparture, readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import OperationalControlClient from "@/app/agenzia/viaggi/[id]/operativita/operational-control-client";

export const dynamic = "force-dynamic";

export default async function TourLeaderDeparturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!(await canOperateDeparture(user.id, id))) redirect("/tour-leader");
  return (
    <OperationalControlClient
      departureId={id}
      initialData={await readDepartureOperationalControl(user.id, id, user.nativeId)}
      backHref="/tour-leader"
      backLabel="Le tue partenze"
    />
  );
}
