import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getTravelerExperience } from "@/lib/platform/traveler-experience";
import TravelExperience from "./travel-experience";
import "./travel.css";

export const dynamic = "force-dynamic";

export default async function TravelerJourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ partenza?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/viaggio");
  const { partenza } = await searchParams;
  const experience = await getTravelerExperience(user.id, partenza);

  if (!experience) {
    return (
      <main className="travelEmpty">
        <span>SMF</span>
        <h1>Nessun viaggio disponibile</h1>
        <p>L’agenzia non ha ancora associato il tuo account a una famiglia e a un viaggio pubblicato.</p>
        <form action="/api/auth/logout" method="post"><button type="submit">Esci</button></form>
      </main>
    );
  }
  if (!experience.journey.catalogReady) redirect("/");

  return <TravelExperience initialExperience={experience} userName={user.name} isAgencyAdmin={user.isAgencyAdmin}/>;
}
