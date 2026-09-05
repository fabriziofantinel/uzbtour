import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getAgencyProgramme } from "@/lib/platform/programme-repository";
import ProgrammeEditor from "./programme-editor";
import "./programme.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");
    const { id } = await params;
    const programme = await getAgencyProgramme(id, actor.id, actor.nativeId, !actor.isAgencyAdmin);
    const editableDayIds = actor.isAgencyAdmin
      ? undefined
      : (
          await getSql()`SELECT day_id::text id
            FROM unnest(${programme.days.map((day) => day.id)}::uuid[]) AS days(day_id)
            WHERE app.can_edit_departure_day_v3(${actor.nativeId}::uuid,${id}::uuid,day_id)`
        ).map((row) => String(row.id));
    return <ProgrammeEditor initialProgramme={programme} editableDayIds={editableDayIds} />;
  } catch (error) {
    if (error instanceof Error && /Partenza non trovata/.test(error.message)) redirect("/");
    throw error;
  }
}
