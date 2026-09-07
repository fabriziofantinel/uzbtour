import { redirect } from "next/navigation";
import { requireDepartureCollaborator } from "@/lib/platform/authorization";
import { readDepartureStaffRole } from "@/lib/platform/departure-operational-control";
import { readRoomingList } from "@/lib/platform/rooming-list";
import RoomingListClient from "./rooming-list-client";
import "./rooming.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function RoomingListPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireDepartureCollaborator(id);
    const [data, staffRole] = await Promise.all([
      readRoomingList(actor.nativeId, id),
      actor.isAgencyAdmin ? Promise.resolve(null) : readDepartureStaffRole(actor.nativeId, id),
    ]);
    return <RoomingListClient initialData={data} staffRole={staffRole} />;
  } catch {
    redirect("/");
  }
}
