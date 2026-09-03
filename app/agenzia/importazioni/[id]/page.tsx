import { redirect } from "next/navigation";
import { PlatformAuthorizationError, requireAgencyAdmin } from "@/lib/platform/authorization";
import { getImportAgency, getImportAgencyPrimaryColor, getImportForReview } from "@/lib/platform/import-repository";
import ImportReview from "./review-client";
import "./review.css";
import "./validation.css";
import "./normalized.css";
import "../../../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const agencyId = await getImportAgency(id);
    const actor = await requireAgencyAdmin(agencyId);
    const imported = await getImportForReview(id, agencyId);
    return (
      <ImportReview
        initialImport={imported}
        agencyPrimaryColor={await getImportAgencyPrimaryColor(actor.nativeId, agencyId)}
      />
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
