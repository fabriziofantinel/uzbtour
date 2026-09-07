"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  BedDouble,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  LogOut,
  MessageCircle,
  Send,
  CheckCircle2,
} from "lucide-react";
import OperationalChat from "@/components/operational-chat";
import { validBrandColor } from "@/lib/platform/branding-ui";
import type { StaffTripDocument } from "@/lib/platform/day-documents-repository";
import type { AgencyProgramme } from "@/lib/platform/programme-repository";
import type { readDepartureCommunications } from "@/lib/platform/departure-operations";

type StaffRole = "agent" | "accompagnatore" | "guida";
type Tab = "programma" | "documenti" | "chat" | "comunicazioni";

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

export default function StaffTripExperience({
  programme,
  documents,
  staffUserId,
  staffName,
  staffRole,
  agencyName,
  agencyLogoUrl,
  communications: initialCommunications,
}: {
  programme: AgencyProgramme;
  documents: StaffTripDocument[];
  staffUserId: string;
  staffName: string;
  staffRole: StaffRole;
  agencyName: string;
  agencyLogoUrl: string;
  communications: Awaited<ReturnType<typeof readDepartureCommunications>>;
}) {
  const [tab, setTab] = useState<Tab>("programma");
  const [activeDay, setActiveDay] = useState(0);
  const [chatScope, setChatScope] = useState<"trip" | "agency">("agency");
  const [communications, setCommunications] =
    useState<Awaited<ReturnType<typeof readDepartureCommunications>>>(initialCommunications);
  const [communicationBusy, setCommunicationBusy] = useState("");
  const day = programme.days[activeDay] ?? programme.days[0];
  const agencyColor = validBrandColor(programme.departure.agencyPrimaryColor);
  const style = {
    "--agency-ui": agencyColor,
    "--smf-brand": agencyColor,
    "--smf-action": agencyColor,
    "--teal": agencyColor,
  } as CSSProperties;
  const roleLabel = staffRole === "guida" ? "Guida" : staffRole === "agent" ? "Agente" : "Accompagnatore";

  return (
    <main className="staffTripExperience travelerRedesign" style={style}>
      <header className="staffTripTopbar">
        <Link href="/tour-leader" aria-label="Torna ai viaggi">
          <ArrowLeft />
        </Link>
        <span className="staffTripBrand">
          {agencyLogoUrl ? <img src={agencyLogoUrl} alt={`Logo ${agencyName}`} /> : <i>{agencyName.slice(0, 2)}</i>}
          <span>
            <strong>{agencyName}</strong>
            <small>{roleLabel}</small>
          </span>
        </span>
        <form action="/api/auth/logout" method="post">
          <button type="submit" aria-label="Esci">
            <LogOut />
          </button>
        </form>
      </header>

      <section className="staffTripHero">
        <span>{programme.departure.destinationCountry}</span>
        <h1>{programme.departure.title}</h1>
        <p>
          <CalendarDays /> {dateLabel(programme.departure.startsOn)} – {dateLabel(programme.departure.endsOn)}
        </p>
        <small>Vista di {staffName}</small>
      </section>

      <nav className="staffTripTabs" aria-label="Sezioni del viaggio">
        <button type="button" className={tab === "programma" ? "active" : ""} onClick={() => setTab("programma")}>
          <BookOpen /> Programma
        </button>
        <button type="button" className={tab === "documenti" ? "active" : ""} onClick={() => setTab("documenti")}>
          <FileText /> Documenti
        </button>
        <button type="button" className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          <MessageCircle /> Chat
        </button>
        <button
          type="button"
          className={tab === "comunicazioni" ? "active" : ""}
          onClick={() => setTab("comunicazioni")}
        >
          <Send /> Comunicazioni
        </button>
      </nav>

      <div className="staffTripContent">
        {tab === "programma" && day && (
          <section className="staffProgramme" aria-labelledby="staff-programme-title">
            <div className="staffDayPicker">
              {programme.days.map((item, index) => (
                <button
                  type="button"
                  className={activeDay === index ? "active" : ""}
                  onClick={() => setActiveDay(index)}
                  key={item.id}
                >
                  <small>Giorno</small>
                  <strong>{item.number}</strong>
                  <span>{item.city || item.title}</span>
                </button>
              ))}
            </div>
            <article className="staffDayDetail">
              <header>
                <div>
                  <small>GIORNO {day.number}</small>
                  <h2 id="staff-programme-title">{day.title}</h2>
                  <p>{day.city}</p>
                </div>
                <div className="staffDayPager">
                  <button
                    type="button"
                    disabled={activeDay === 0}
                    onClick={() => setActiveDay((current) => Math.max(0, current - 1))}
                    aria-label="Giorno precedente"
                  >
                    <ChevronLeft />
                  </button>
                  <button
                    type="button"
                    disabled={activeDay === programme.days.length - 1}
                    onClick={() => setActiveDay((current) => Math.min(programme.days.length - 1, current + 1))}
                    aria-label="Giorno successivo"
                  >
                    <ChevronRight />
                  </button>
                </div>
              </header>
              {day.description && <p className="staffDayDescription">{day.description}</p>}
              <div className="staffProgrammeItems">
                {day.items.map((item, index) => (
                  <article key={item.id}>
                    <span>{index + 1}</span>
                    <div>
                      <small>
                        {item.type}
                        {item.startsAt && (
                          <time>
                            <Clock3 /> {item.startsAt}
                          </time>
                        )}
                      </small>
                      <strong>{item.title}</strong>
                      {item.description && <p>{item.description}</p>}
                    </div>
                  </article>
                ))}
                {!day.items.length && <p className="staffTripEmpty">Nessuna attività prevista per questa giornata.</p>}
              </div>
              {day.hotels.length > 0 && (
                <div className="staffStays">
                  <BedDouble />
                  <span>
                    <small>Pernottamento</small>
                    <strong>{day.hotels.map((hotel) => hotel.name).join(" · ")}</strong>
                  </span>
                </div>
              )}
            </article>
          </section>
        )}

        {tab === "documenti" && (
          <section className="staffDocuments" aria-labelledby="staff-documents-title">
            <header>
              <FileText />
              <div>
                <h2 id="staff-documents-title">Documenti</h2>
                <p>Documenti del viaggio e documenti inviati direttamente a te dall’agenzia.</p>
              </div>
            </header>
            {documents.length ? (
              <div>
                {documents.map((document) => {
                  const documentDay = programme.days.find((item) => item.id === document.dayId);
                  return (
                    <article key={document.id}>
                      <FileText />
                      <span>
                        <small>
                          {document.staffRole ? "PER TE" : "VIAGGIO"}
                          {documentDay ? ` · GIORNO ${documentDay.number}` : ""}
                        </small>
                        <strong>{document.title}</strong>
                        {document.description && <p>{document.description}</p>}
                      </span>
                      <a href={document.downloadUrl} download aria-label={`Scarica ${document.title}`}>
                        <Download /> <span>Scarica</span>
                      </a>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="staffTripEmpty">Nessun documento disponibile per il viaggio o inviato a te.</p>
            )}
          </section>
        )}

        {tab === "chat" && (
          <section className="staffPersonalChat" aria-labelledby="staff-chat-heading">
            <h2 id="staff-chat-heading">Chat</h2>
            <div className="staffChatScopes" role="tablist" aria-label="Conversazioni disponibili">
              {staffRole !== "guida" && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatScope === "trip"}
                  className={chatScope === "trip" ? "active" : ""}
                  onClick={() => setChatScope("trip")}
                >
                  Viaggio
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={chatScope === "agency"}
                className={chatScope === "agency" ? "active" : ""}
                onClick={() => setChatScope("agency")}
              >
                Con l’agenzia
              </button>
            </div>
            {chatScope === "trip" ? (
              <OperationalChat departureId={programme.departure.id} scope="trip" />
            ) : staffRole === "accompagnatore" || staffRole === "guida" ? (
              <OperationalChat departureId={programme.departure.id} scope={staffRole} staffUserId={staffUserId} />
            ) : (
              <p className="staffTripEmpty">La chat personale con l’agenzia non è prevista per questo ruolo.</p>
            )}
          </section>
        )}

        {tab === "comunicazioni" && (
          <section className="staffDocuments" aria-labelledby="staff-communications-title">
            <header>
              <Send />
              <div>
                <h2 id="staff-communications-title">Comunicazioni</h2>
                <p>Avvisi operativi inviati direttamente a te dall’agenzia o dall’accompagnatore.</p>
              </div>
            </header>
            {communications.length ? (
              <div>
                {communications.map((notice) => (
                  <article key={notice.id}>
                    <Send />
                    <span>
                      <small>
                        {notice.severity === "urgent"
                          ? "URGENTE"
                          : notice.severity === "important"
                            ? "IMPORTANTE"
                            : "INFORMATIVA"}
                      </small>
                      <strong>{notice.title}</strong>
                      <p>{notice.summary}</p>
                      <small>{new Date(notice.publishedAt).toLocaleString("it-IT")}</small>
                    </span>
                    {notice.requiresAcknowledgement && !notice.readAt ? (
                      <button
                        type="button"
                        disabled={communicationBusy === notice.id}
                        onClick={async () => {
                          setCommunicationBusy(notice.id);
                          const response = await fetch("/api/staff/communications", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              departureId: programme.departure.id,
                              noticeId: notice.id,
                              clientOperationId: crypto.randomUUID(),
                            }),
                          });
                          if (response.ok)
                            setCommunications((current) =>
                              current.map((item) =>
                                item.id === notice.id ? { ...item, readAt: new Date().toISOString() } : item,
                              ),
                            );
                          setCommunicationBusy("");
                        }}
                      >
                        <CheckCircle2 /> Ho letto
                      </button>
                    ) : notice.readAt ? (
                      <small>Letta</small>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="staffTripEmpty">Nessuna comunicazione ricevuta.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
