import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { agencyLogoSource } from "@/lib/platform/branding-ui";
import { canOperateDeparture, readMyDepartureStaff } from "@/lib/platform/departure-operational-control";
import { getStaffTripDocuments } from "@/lib/platform/day-documents-repository";
import { getAgencyProgramme } from "@/lib/platform/programme-repository";
import StaffTripExperience from "./staff-trip-experience";
import "./staff-trip-experience.css";

export const dynamic = "force-dynamic";

export default async function TourLeaderDeparturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const [assignments, allowed] = await Promise.all([
    readMyDepartureStaff(user.nativeId),
    canOperateDeparture(user.nativeId, id),
  ]);
  const assignment = assignments.find((item) => item.id === id);
  if (!assignment || !allowed) redirect("/tour-leader");

  const [programme, documents] = await Promise.all([
    getAgencyProgramme(id, user.id, user.nativeId, true),
    getStaffTripDocuments(user.nativeId, id),
  ]);

  return (
    <StaffTripExperience
      programme={programme}
      documents={documents}
      staffUserId={user.nativeId}
      staffName={user.name}
      staffRole={assignment.role}
      agencyName={assignment.agencyName}
      agencyLogoUrl={agencyLogoSource(assignment.logoUrl, assignment.agencyId)}
    />
  );
}
