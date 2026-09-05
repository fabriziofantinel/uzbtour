import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { LogOut, MapPinned } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { readMyDepartureStaff, readStaffDashboard } from "@/lib/platform/departure-operational-control";
import { agencyLogoSource, validBrandColor } from "@/lib/platform/branding-ui";

import StaffTrips from "./staff-trips";

export const dynamic = "force-dynamic";

export default async function TourLeaderHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [departures, trips] = await Promise.all([
    readMyDepartureStaff(user.nativeId),
    readStaffDashboard(user.nativeId),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const agency = departures[0];
  const color = validBrandColor(agency?.primaryColor);
  const activeTrips = departures.filter(
    (departure) =>
      !(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(departure.endsOn)) < today),
  );
  const style = {
    "--agency-ui": color,
    "--smf-brand": color,
    "--smf-brand-deep": color,
    "--smf-action": color,
  } as CSSProperties;
  const role = agency?.role === "guida" ? "Guida" : agency?.role === "agent" ? "Agente" : "Accompagnatore";
  return (
    <main className="agencyPage" style={style}>
      <a className="agidSkipLink" href="#main-content">
        Salta all’elenco dei viaggi
      </a>
      <header className="agencyTopbar">
        <Link className="agencyBrand" href="/tour-leader">
          {agency?.logoUrl ? (
            <img src={agencyLogoSource(agency.logoUrl, agency.agencyId)} alt={`Logo ${agency.agencyName}`} />
          ) : (
            <span>{agency?.agencyName.slice(0, 2).toUpperCase() || "AG"}</span>
          )}
          <div>
            <strong>{agency?.agencyName || "Viaggi assegnati"}</strong>
            <small>PANNELLO OPERATORE</small>
          </div>
        </Link>
        <div className="agencyUser">
          <i>{user.initials}</i>
          <span>
            <small>{role}</small>
            <b>{user.name}</b>
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" aria-label="Esci">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </header>
      <section className="agencyHero">
        <div>
          <h1>Buongiorno, {user.name}.</h1>
          <span>Consulta i viaggi assegnati e apri il programma.</span>
        </div>
      </section>
      <div className="agencyShell">
        <aside className="agencySidebar">
          <nav>
            <Link className="active" href="/tour-leader" aria-current="page">
              <MapPinned size={18} /> Viaggi
            </Link>
            <div className="tourLeaderActiveTrips">
              {activeTrips.length ? (
                activeTrips.map((departure) => (
                  <Link
                    key={departure.id}
                    className="tourLeaderActiveTrip"
                    href={`/tour-leader/${departure.id}`}
                    title={`${departure.title} (${departure.agencyName})`}
                  >
                    <span className="tourLeaderActiveTripName">{departure.title}</span>
                    <small>{departure.agencyName}</small>
                  </Link>
                ))
              ) : (
                <span className="tourLeaderEmptyTrips">Nessun viaggio attivo</span>
              )}
            </div>
          </nav>
        </aside>
        <section id="main-content" className="agencyContent" tabIndex={-1}>
          <StaffTrips trips={trips} today={today} />
        </section>
      </div>
    </main>
  );
}
