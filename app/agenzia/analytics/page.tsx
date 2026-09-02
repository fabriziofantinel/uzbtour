import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  BarChart3,
  CalendarRange,
  FileText,
  LogOut,
  MapPinned,
  MessageCircle,
  Star,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { CSSProperties } from "react";
import { PlatformAuthorizationError, requirePlatformAdmin } from "@/lib/platform/authorization";
import { getPlatformOverview } from "@/lib/platform/repository";
import { getAgencyAnalytics } from "@/lib/platform/agency-analytics";
import {
  accessibleBrandBackground,
  accessibleBrandColor,
  agencyLogoSource,
  validBrandColor,
} from "@/lib/platform/branding-ui";
import "./analytics.css";

export const dynamic = "force-dynamic";

const percent = (value: number, total: number) => (total ? Math.round((value / total) * 100) : 0);
const date = (value: string) =>
  new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );

export default async function AgencyAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; departure?: string }>;
}) {
  try {
    const actor = await requirePlatformAdmin();
    const overview = await getPlatformOverview(actor);
    const agency = overview.agencies[0];
    if (!agency) redirect("/agenzia");
    const query = await searchParams;
    const period = [7, 30, 90].includes(Number(query.period)) ? Number(query.period) : 30;
    const departureIds = new Set(agency.trips.flatMap((trip) => trip.departures.map((item) => item.id)));
    const departure = query.departure && departureIds.has(query.departure) ? query.departure : undefined;
    const analytics = await getAgencyAnalytics({ agencyId: agency.id, periodDays: period, departureId: departure });
    const color = validBrandColor(agency.primaryColor);
    const style = {
      "--agency-ui": accessibleBrandBackground(color),
      "--smf-brand": color,
      "--smf-brand-deep": accessibleBrandColor(color),
    } as CSSProperties;
    const s = analytics.summary;
    const activation = percent(s.activatedTravelers, s.invitedTravelers);
    const adoption = percent(s.activeTravelers, s.invitedTravelers);
    const allDepartures = agency.trips.flatMap((trip) =>
      trip.departures.map((item) => ({ id: item.id, title: item.title || trip.title })),
    );
    return (
      <main className="agencyPage analyticsPage" style={style}>
        <a className="agidSkipLink" href="#analytics-content">
          Salta agli indicatori
        </a>
        <header className="agencyTopbar">
          <Link className="agencyBrand" href="/agenzia">
            {agency.logoUrl ? (
              <img src={agencyLogoSource(agency.logoUrl, agency.id)} alt={`Logo ${agency.name}`} />
            ) : (
              <span>
                {agency.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </span>
            )}
            <div>
              <strong>{agency.name}</strong>
              <small>PANNELLO AGENZIA</small>
            </div>
          </Link>
          <div className="agencyUser">
            <i>{overview.actor.name.slice(0, 2).toUpperCase()}</i>
            <span>
              <small>{agency.role === "editor" ? "Agente" : "Amministratore"}</small>
              <b>{overview.actor.name}</b>
            </span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" aria-label="Esci">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </header>
        <section className="analyticsBanner">
          <div>
            <BarChart3 />
            <span>
              <h1>Come viene vissuto il viaggio</h1>
              <p>
                Dall’attivazione al feedback: segnali utili per intervenire prima che un problema diventi una richiesta
                urgente.
              </p>
            </span>
          </div>
        </section>
        <div className="agencyShell">
          <aside className="agencySidebar">
            <nav>
              <Link href="/agenzia">
                <MapPinned size={18} /> Viaggi
              </Link>
              {agency.role === "owner" && (
                <Link href="/agenzia/agenti">
                  <UserPlus size={18} /> Agenti
                </Link>
              )}
              <Link className="active" href="/agenzia/analytics" aria-current="page">
                <BarChart3 size={18} /> Analytics
              </Link>
            </nav>
          </aside>
          <section id="analytics-content" className="agencyContent analyticsContent" tabIndex={-1}>
            <header className="analyticsHeading">
              <div>
                <h2>Andamento dell’agenzia</h2>
                <p>
                  Dati aggregati, aggiornati al{" "}
                  {new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(
                    new Date(analytics.generatedAt),
                  )}
                  .
                </p>
              </div>
              <form className="analyticsFilters">
                <label>
                  Periodo
                  <select name="period" defaultValue={String(period)}>
                    <option value="7">Ultimi 7 giorni</option>
                    <option value="30">Ultimi 30 giorni</option>
                    <option value="90">Ultimi 90 giorni</option>
                  </select>
                </label>
                <label>
                  Partenza
                  <select name="departure" defaultValue={departure ?? ""}>
                    <option value="">Tutte le partenze</option>
                    {allDepartures.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Applica filtri</button>
              </form>
            </header>

            <section className="analyticsSignalRail" aria-label="Indicatori principali">
              <article>
                <span>
                  <UsersRound />
                </span>
                <div>
                  <small>ADOZIONE</small>
                  <strong>{adoption}%</strong>
                  <p>
                    {s.activeTravelers} attivi su {s.invitedTravelers} viaggiatori abilitati
                  </p>
                </div>
              </article>
              <article>
                <span>
                  <MapPinned />
                </span>
                <div>
                  <small>PROGRAMMA</small>
                  <strong>{s.programmeViews}</strong>
                  <p>consultazioni nel periodo</p>
                </div>
              </article>
              <article>
                <span>
                  <FileText />
                </span>
                <div>
                  <small>DOCUMENTI</small>
                  <strong>{s.documentUsers}</strong>
                  <p>viaggiatori che hanno scaricato file</p>
                </div>
              </article>
              <article>
                <span>
                  <MessageCircle />
                </span>
                <div>
                  <small>ASSISTENZA</small>
                  <strong>{s.assistanceRequests}</strong>
                  <p>messaggi inviati dai viaggiatori</p>
                </div>
              </article>
              <article>
                <span>
                  <Activity />
                </span>
                <div>
                  <small>ENGAGEMENT</small>
                  <strong>{s.engagementActions}</strong>
                  <p>quiz, sfide e contest completati</p>
                </div>
              </article>
              <article>
                <span>
                  <Star />
                </span>
                <div>
                  <small>FEEDBACK</small>
                  <strong>{s.averageFeedback == null ? "—" : s.averageFeedback.toFixed(1)}</strong>
                  <p>{s.feedbackCount} valutazioni per tappa</p>
                </div>
              </article>
            </section>

            <section className="adoptionPanel">
              <div>
                <h3>Adozione del servizio</h3>
                <p>La distanza tra invitati, attivati e utenti realmente attivi mostra dove serve accompagnamento.</p>
              </div>
              <div className="adoptionSteps">
                <article>
                  <span>1</span>
                  <strong>{s.invitedTravelers}</strong>
                  <small>Viaggiatori invitati</small>
                  <i style={{ "--value": "100%" } as CSSProperties} />
                </article>
                <article>
                  <span>2</span>
                  <strong>{s.activatedTravelers}</strong>
                  <small>Account attivati · {activation}%</small>
                  <i style={{ "--value": `${activation}%` } as CSSProperties} />
                </article>
                <article>
                  <span>3</span>
                  <strong>{s.activeTravelers}</strong>
                  <small>Utenti attivi · {adoption}%</small>
                  <i style={{ "--value": `${adoption}%` } as CSSProperties} />
                </article>
              </div>
            </section>

            <section className="analyticsSection">
              <div className="analyticsSectionTitle">
                <div>
                  <h3>Segnali per partenza</h3>
                  <p>Confronta adozione e utilizzo, senza esporre attività personali del singolo viaggiatore.</p>
                </div>
                <CalendarRange />
              </div>
              {analytics.departures.length === 0 ? (
                <div className="analyticsEmpty">Nessuna partenza disponibile per i filtri selezionati.</div>
              ) : (
                <div className="analyticsTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Partenza</th>
                        <th>Adozione</th>
                        <th>Programma</th>
                        <th>Documenti</th>
                        <th>Assistenza</th>
                        <th>Engagement</th>
                        <th>Feedback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.departures.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.title}</strong>
                            <small>{date(item.startsOn)}</small>
                          </td>
                          <td>
                            <b>{percent(item.active, item.activated)}%</b>
                            <small>
                              {item.active}/{item.activated} attivi
                            </small>
                          </td>
                          <td>{item.programmeViews}</td>
                          <td>{item.documentUsers}</td>
                          <td>{item.assistanceRequests}</td>
                          <td>{item.engagementActions}</td>
                          <td>
                            {item.feedbackAverage == null ? (
                              "—"
                            ) : (
                              <span className={item.feedbackAverage < 3 ? "needsAttention" : ""}>
                                {item.feedbackAverage.toFixed(1)} / 5
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="analyticsSection feedbackPanel">
              <div className="analyticsSectionTitle">
                <div>
                  <h3>Feedback per tappa</h3>
                  <p>Le valutazioni più basse compaiono per prime all’interno di ogni giornata.</p>
                </div>
                <Star />
              </div>
              {analytics.feedback.length === 0 ? (
                <div className="analyticsEmpty">Non sono ancora presenti valutazioni nel periodo selezionato.</div>
              ) : (
                <div className="feedbackList">
                  {analytics.feedback.map((item) => (
                    <article key={item.itemId}>
                      <div>
                        <small>
                          GIORNO {item.dayNumber} · {item.dayTitle}
                        </small>
                        <strong>{item.itemTitle}</strong>
                        <span>
                          {item.responses} {item.responses === 1 ? "risposta" : "risposte"}
                        </span>
                      </div>
                      <div className="feedbackScore">
                        <b className={item.average < 3 ? "needsAttention" : ""}>{item.average.toFixed(1)}</b>
                        <span aria-label={`${item.average.toFixed(1)} stelle su 5`}>
                          <i style={{ width: `${(item.average / 5) * 100}%` }} />
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="analyticsSection">
              <div className="analyticsSectionTitle">
                <div>
                  <h3>Definizioni KPI</h3>
                  <p>Formule versionate, aggiornate ogni 15 minuti e consolidate giornalmente.</p>
                </div>
                <BarChart3 />
              </div>
              <div className="analyticsTableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>KPI</th>
                      <th>Formula</th>
                      <th>Numeratore</th>
                      <th>Denominatore</th>
                      <th>Versione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.definitions.map((item) => (
                      <tr key={item.code}>
                        <td>
                          <strong>{item.label}</strong>
                          <small>{item.code}</small>
                        </td>
                        <td>{item.formula}</td>
                        <td>{item.numerator}</td>
                        <td>{item.denominator}</td>
                        <td>
                          v{item.version} · {item.refreshMinutes} min
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }
}
