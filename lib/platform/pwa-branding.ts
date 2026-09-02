import { getCurrentUser } from "@/lib/current-user";
import { validBrandColor } from "./branding-ui";
import { readV3TravelerJourneys } from "./v3-traveler-scope";

export type TravelerPwaBranding = {
  agencyId: string;
  agencyName: string;
  logoUrl: string;
  primaryColor: string;
};

export async function getTravelerPwaBranding(): Promise<TravelerPwaBranding | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const journeys = await readV3TravelerJourneys(user.id);
  const journey = journeys[0];
  if (!journey) return null;
  const branding =
    journey.agency_branding && typeof journey.agency_branding === "object" && !Array.isArray(journey.agency_branding)
      ? (journey.agency_branding as Record<string, unknown>)
      : {};
  return {
    agencyId: String(journey.agency_id),
    agencyName: String(journey.agency_name || "SMF Travel"),
    logoUrl: String(branding.logoUrl || ""),
    primaryColor: validBrandColor(String(branding.primaryColor || "")),
  };
}
