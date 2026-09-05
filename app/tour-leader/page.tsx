import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { BookOpen, LogOut, MapPinned } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { readMyDepartureStaff } from "@/lib/platform/departure-operational-control";
import { agencyLogoSource, validBrandColor } from "@/lib/platform/branding-ui";

export const dynamic = "force-dynamic";

export default async function TourLeaderHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const departures = await readMyDepartureStaff(user.nativeId);
  const agency = departures[0];
  const color = validBrandColor(agency?.primaryColor);
  const style = {
    "--agency-ui": color,
    "--smf-brand": color,
    "--smf-brand-deep": color,
    "--smf-action": color,
  } as CSSProperties;
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date));
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
          </nav>
        </aside>
        <section id="main-content" className="agencyContent" tabIndex={-1}>
          <div className="agencySectionHead">
            <div>
              <h2>Viaggi</h2>
              <p>
                {departures.length} {departures.length === 1 ? "viaggio assegnato" : "viaggi assegnati"}
              </p>
            </div>
          </div>
          <div className="tripTableWrap">
            <table className="tripTable">
              <caption>Elenco dei viaggi assegnati</caption>
              <thead>
                <tr>
                  <th>Viaggio</th>
                  <th>Periodo</th>
                  <th>Gruppi</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {departures.map((departure) => (
                  <tr key={`${departure.id}-${departure.role}`}>
                    <td data-label="Viaggio" className="tripNameCell">
                      <b>{departure.title}</b>
                      <span>{departure.agencyName}</span>
                    </td>
                    <td data-label="Periodo" className="dateRangeCell">
                      <b>{formatDate(departure.startsOn)}</b>
                      <span aria-hidden="true">→</span>
                      <b>{formatDate(departure.endsOn)}</b>
                    </td>
                    <td data-label="Gruppi" className="numberCell">
                      {departure.partyCount}
                    </td>
                    <td data-label="Azioni">
                      <div className="tableActions inline">
                        <Link className="primary" href={`/agenzia/viaggi/${departure.id}/programma`}>
                          <BookOpen /> Apri programma
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!departures.length && (
              <div className="agencyEmpty">
                <p>Nessun viaggio assegnato disponibile.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
