import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getAgencyProgramme } from "@/lib/platform/programme-repository";
import ProgrammeEditor from "./programme-editor";
import "./programme.css";
import "../../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await params;
    return <ProgrammeEditor initialProgramme={await getAgencyProgramme(id, actor.id, actor.nativeId)} />;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
