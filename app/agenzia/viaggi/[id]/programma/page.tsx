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
    const editableDayIds = actor.isAgencyAdmin
      ? undefined
      : (
          await getSql()`SELECT coverage.departure_day_id::text id
            FROM travel.departure_staff_day_assignments coverage
            JOIN travel.departure_staff_assignments assignment ON assignment.id=coverage.staff_assignment_id
            WHERE assignment.user_id=${actor.nativeId}::uuid AND assignment.departure_id=${id}::uuid
              AND assignment.status='active'`
        ).map((row) => String(row.id));
    return (
      <ProgrammeEditor
        initialProgramme={await getAgencyProgramme(id, actor.id, actor.nativeId, !actor.isAgencyAdmin)}
        editableDayIds={editableDayIds}
      />
    );
  } catch (error) {
    if (error instanceof Error && /Partenza non trovata/.test(error.message)) redirect("/");
    throw error;
  }
}
