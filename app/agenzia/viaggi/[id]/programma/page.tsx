import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
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
    return (
      <ProgrammeEditor
        initialProgramme={await getAgencyProgramme(id, actor.id, actor.nativeId, !actor.isAgencyAdmin)}
      />
    );
  } catch (error) {
    if (error instanceof Error && /Partenza non trovata/.test(error.message)) redirect("/");
    throw error;
  }
}
