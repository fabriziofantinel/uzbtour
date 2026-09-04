import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, LogOut, Route } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { readMyDepartureStaff } from "@/lib/platform/departure-operational-control";

export const dynamic = "force-dynamic";

export default async function TourLeaderHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const departures = await readMyDepartureStaff(user.nativeId);
  if (!departures.length) redirect("/");
  return (
    <main className="journeyManagePage">
      <header>
        <strong>Personale operativo · {user.name}</strong>
        <a href="/api/auth/logout">
          <LogOut /> Esci
        </a>
      </header>
      <section className="journeyManageHero">
        <small>INCARICHI OPERATIVI</small>
        <h1>Le tue partenze</h1>
        <p>Visualizzi soltanto le partenze assegnate durante il periodo autorizzato.</p>
      </section>
      <div className="journeyManageShell">
        <section className="agencyPanel">
          <h2>
            <Route /> Partenze assegnate
          </h2>
          <ul className="agencyStackList">
            {departures.map((departure) => (
              <li key={departure.id}>
                <span>
                  <strong>{departure.title}</strong>
                  <small>
                    {departure.role === "accompagnatore"
                      ? "Accompagnatore"
                      : departure.role === "guida"
                        ? "Guida"
                        : "Agente"}{" "}
                    · {departure.agencyName} · {new Date(departure.startsOn).toLocaleDateString("it-IT")} -{" "}
                    {new Date(departure.endsOn).toLocaleDateString("it-IT")}
                  </small>
                </span>
                <Link href={`/tour-leader/${departure.id}`}>
                  <CalendarDays /> Apri viaggio
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
