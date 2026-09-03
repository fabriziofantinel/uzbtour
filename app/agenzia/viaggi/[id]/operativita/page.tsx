import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { readDepartureOperationalControl } from "@/lib/platform/departure-operational-control";
import OperationalControlClient from "./operational-control-client";

export const dynamic = "force-dynamic";
export default async function OperationalControlPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  return (
    <OperationalControlClient
      departureId={id}
      initialData={await readDepartureOperationalControl(user.id, id, user.nativeId)}
    />
  );
}
