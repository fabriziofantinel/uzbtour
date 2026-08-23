"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Banknote, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock3,
  ExternalLink, House, Info, Languages, LoaderCircle, LogOut, Map, MapPin,
  Plus, ReceiptText, Sparkles, UsersRound,
} from "lucide-react";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";

type Tab = "map" | "today" | "programme" | "expenses" | "info" | "phrases" | "challenges";

const tabs: Array<{ id: Tab; label: string; icon: typeof Map }> = [
  { id: "map", label: "Mappa", icon: Map },
  { id: "today", label: "Oggi", icon: House },
  { id: "programme", label: "Programma", icon: CalendarDays },
  { id: "expenses", label: "Spese", icon: ReceiptText },
  { id: "info", label: "Info utili", icon: Info },
  { id: "phrases", label: "Frasi", icon: Languages },
  { id: "challenges", label: "Sfide", icon: Sparkles },
];

const money = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" });

function formatDate(value: string) {
  if (!value) return "Data da confermare";
  return dayDate.format(new Date(`${value}T12:00:00`));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ChallengeBody({ content, type }: { content: unknown; type: string }) {
  const item = record(content);
  const description = String(item.description || item.instructions || item.question || "");
  const options = Array.isArray(item.options) ? item.options.map(String) : [];
  return <>{description && <p>{description}</p>}{options.length > 0 && <ol>{options.map((option) => <li key={option}>{option}</li>)}</ol>}{type.includes("game") && item.answer && <details><summary>Mostra soluzione</summary><b>{String(item.answer)}</b></details>}</>;
}

export default function TravelExperience({ initialExperience, userName }: { initialExperience: Experience; userName: string }) {
  const [experience, setExperience] = useState(initialExperience);
  const [tab, setTab] = useState<Tab>("today");
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return experience.days.find((day) => day.date === today)?.number ?? experience.days[0]?.number ?? 1;
  });
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [mapDay, setMapDay] = useState(experience.days[0]?.number ?? 1);
  const day = experience.days.find((entry) => entry.number === selectedDay) ?? experience.days[0];
  const mappedDay = experience.days.find((entry) => entry.number === mapDay) ?? experience.days[0];
  const dayChallenges = experience.challenges.filter((entry) => entry.dayNumber === selectedDay);
  const bingo = experience.challenges.filter((entry) => entry.type === "bingo_item");
  const totals = useMemo(() => experience.expenses.reduce<Record<string, number>>((sum, entry) => {
    sum[entry.currency] = (sum[entry.currency] ?? 0) + entry.amount;
    return sum;
  }, {}), [experience.expenses]);

  function openProgramme(number: number) {
    setSelectedDay(number);
    setTab("programme");
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get("amount") || "").replace(",", "."));
    setExpenseBusy(true); setExpenseError("");
    try {
      const response = await fetch("/api/traveler/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departureId: experience.journey.departureId, partyId: experience.journey.partyId,
          dayId: form.get("dayId") || null, label: form.get("label"), amount,
          currency: form.get("currency"),
        }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "Salvataggio non riuscito");
      const expenseDay = experience.days.find((entry) => entry.id === form.get("dayId"));
      setExperience((previous) => ({ ...previous, expenses: [{
        id: result.id!, dayId: String(form.get("dayId") || "") || null,
        dayNumber: expenseDay?.number ?? null, label: String(form.get("label")), amount,
        currency: String(form.get("currency")), paidBy: userName, createdAt: new Date().toISOString(),
      }, ...previous.expenses] }));
      setExpenseOpen(false);
    } catch (error) { setExpenseError(error instanceof Error ? error.message : "Salvataggio non riuscito"); }
    finally { setExpenseBusy(false); }
  }

  const mapQuery = encodeURIComponent(`${mappedDay?.city || experience.journey.destinationCountry}, ${experience.journey.destinationCountry}`);

  return (
    <main className="travelerApp">
      <header className="travelerHeader">
        <a className="travelerBrand" href="/viaggio"><span>SMF</span><div><b>{experience.journey.title}</b><small>{experience.journey.agencyName}</small></div></a>
        <div className="travelerMeta"><span><CalendarDays/> {formatDate(experience.journey.startsOn)} — {formatDate(experience.journey.endsOn)}</span><span><UsersRound/> {experience.journey.partyName}</span></div>
        <form action="/api/auth/logout" method="post"><button aria-label="Esci" title="Esci"><LogOut/></button></form>
      </header>

      {experience.availableJourneys.length > 1 && <nav className="journeyPicker" aria-label="Scegli viaggio">{experience.availableJourneys.map((journey) => <a className={journey.departureId === experience.journey.departureId ? "active" : ""} href={`/viaggio?partenza=${journey.departureId}`} key={journey.departureId}>{journey.title}<small>{formatDate(journey.startsOn)}</small></a>)}</nav>}

      <section className="travelHero"><small>{experience.journey.destinationCountry || "IL NOSTRO VIAGGIO"}</small><h1>{experience.journey.title}</h1><p>{experience.journey.travelers.map((traveler) => traveler.name).join(" · ")}</p></section>

      <nav className="travelerTabs" aria-label="Sezioni del viaggio">{tabs.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}><Icon/><span>{label}</span></button>)}</nav>

      <section className="travelContent">
        {tab === "map" && <div className="mapExperience">
          <header><small>LA ROTTA</small><h2>Il viaggio sulla mappa</h2><p>Scegli una giornata per localizzare la tappa e aprire i riferimenti su Google.</p></header>
          <div className="mapExperienceGrid"><div className="mapDays">{experience.days.map((entry) => <button className={entry.number === mapDay ? "active" : ""} onClick={() => setMapDay(entry.number)} key={entry.id}><span>{entry.number}</span><div><small>{formatDate(entry.date)}</small><b>{entry.city}</b></div><ChevronRight/></button>)}</div><div className="mapFrame"><iframe title={`Mappa di ${mappedDay?.city}`} src={`https://www.google.com/maps?q=${mapQuery}&output=embed`} loading="lazy"/><a href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noreferrer"><MapPin/> Apri in Google Maps <ExternalLink/></a></div></div>
        </div>}

        {tab === "today" && day && <div className="todayExperience">
          <header><small>{day.label || `GIORNO ${day.number}`} · {formatDate(day.date)}</small><h2>{day.title}</h2><p><MapPin/> {day.city}</p></header>
          <article className="todaySummary"><p>{day.description}</p><button onClick={() => openProgramme(day.number)}>Apri il programma <ChevronRight/></button></article>
          <div className="todayCards"><article><small>ATTIVITÀ</small><b>{day.items.length}</b><p>appuntamenti e trasferimenti</p></article><article><small>VISITE</small><b>{day.sites.length}</b><p>siti da scoprire</p></article><article><small>HOTEL</small><b>{day.hotels[0]?.name || "Da confermare"}</b><p>{day.hotels[0]?.city || day.city}</p></article><article><small>SFIDE</small><b>{dayChallenges.length}</b><p>contenuti della giornata</p></article></div>
          <section className="todayTimeline"><h3>Programma rapido</h3>{day.items.map((item) => <article key={item.id}><time>{item.startsAt || "—"}</time><span/><div><b>{item.title}</b>{item.description && <p>{item.description}</p>}</div></article>)}</section>
        </div>}

        {tab === "programme" && day && <div className="programmeExperience"><aside><header><small>ITINERARIO</small><h2>Giorno per giorno</h2></header>{experience.days.map((entry) => <button className={entry.number === selectedDay ? "active" : ""} onClick={() => setSelectedDay(entry.number)} key={entry.id}><span>{entry.number}</span><div><small>{formatDate(entry.date)}</small><b>{entry.city}</b><p>{entry.title}</p></div></button>)}</aside><section><header><small>{day.label || `GIORNO ${day.number}`} · {formatDate(day.date)}</small><h2>{day.title}</h2><p><MapPin/> {day.city}</p></header><p className="programmeDescription">{day.description}</p><div className="programmeItems">{day.items.map((item) => <article key={item.id}><span>{item.startsAt || String(day.items.indexOf(item) + 1).padStart(2, "0")}</span><div><small>{item.type}</small><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}{(item.startsAt || item.endsAt) && <em><Clock3/> {item.startsAt || "?"} — {item.endsAt || "?"}</em>}</div></article>)}</div>{day.sites.length > 0 && <div className="travelLinks"><h3>Siti da visitare</h3>{day.sites.map((site) => <a href={site.googleUrl} target="_blank" rel="noreferrer" key={site.id}>{site.name}<small>{site.city}</small><ExternalLink/></a>)}</div>}{day.hotels.length > 0 && <div className="travelLinks"><h3>Hotel</h3>{day.hotels.map((hotel) => <a href={hotel.googleUrl} target="_blank" rel="noreferrer" key={hotel.id}>{hotel.name}<small>{hotel.city}</small><ExternalLink/></a>)}</div>}</section></div>}

        {tab === "expenses" && <div className="expenseExperience"><header><div><small>CONDIVISE CON {experience.journey.partyName.toUpperCase()}</small><h2>Spese del viaggio</h2></div><button onClick={() => setExpenseOpen(true)}><Plus/> Aggiungi spesa</button></header><div className="expenseTotals">{Object.entries(totals).map(([currency, total]) => <article key={currency}><small>TOTALE {currency}</small><b>{money.format(total)} {currency}</b></article>)}{Object.keys(totals).length === 0 && <article><small>TOTALE</small><b>Nessuna spesa</b></article>}</div><div className="expenseList">{experience.expenses.map((expense) => <article key={expense.id}><span><Banknote/></span><div><b>{expense.label}</b><small>{expense.dayNumber ? `Giorno ${expense.dayNumber} · ` : ""}{expense.paidBy}</small></div><strong>{money.format(expense.amount)} {expense.currency}</strong></article>)}</div></div>}

        {tab === "info" && <div className="infoExperience"><header><small>{experience.journey.destinationCountry}</small><h2>Informazioni utili</h2><p>Indicazioni estratte dal programma e contenuti aggiornati per il paese.</p></header><div>{experience.usefulInfo.map((info, index) => <article key={`${info.title}-${index}`}><small>{info.category}</small><h3>{info.title}</h3><p>{info.body}</p>{info.phone && <a href={`tel:${info.phone}`}>{info.phone}</a>}{info.url && <a href={info.url} target="_blank" rel="noreferrer">Approfondisci <ExternalLink/></a>}</article>)}</div></div>}

        {tab === "phrases" && <div className="phraseExperience"><header><small>PAROLE UTILI</small><h2>Frasi da portare con te</h2><p>Pronuncia semplificata e traduzione italiana.</p></header><div>{experience.phrases.map((phrase, index) => <article key={`${phrase.language}-${phrase.term}-${index}`}><small>{phrase.language}</small><h3>{phrase.term}</h3><em>{phrase.pronunciation}</em><p>{phrase.translation}</p></article>)}</div></div>}

        {tab === "challenges" && <div className="challengeExperience"><header><small>GIOCA E SCOPRI</small><h2>Sfide del viaggio</h2><p>Quiz, missioni, giochi, bingo e contest creati sulle visite del programma.</p></header><div className="challengeDayPicker">{experience.days.map((entry) => <button className={entry.number === selectedDay ? "active" : ""} onClick={() => setSelectedDay(entry.number)} key={entry.id}>G{entry.number}</button>)}</div><section><h3>Giorno {selectedDay} · {day?.city}</h3>{dayChallenges.map((challenge) => <article key={challenge.id}><small>{challenge.type.replaceAll("_", " ")}</small><h4>{challenge.title}</h4><ChallengeBody content={challenge.content} type={challenge.type}/></article>)}{dayChallenges.length === 0 && <p className="travelNotice"><CircleAlert/> Nessuna sfida associata a questa giornata.</p>}</section>{bingo.length > 0 && <section><h3>Bingo del viaggio</h3><div className="bingoGrid">{bingo.map((entry) => <span key={entry.id}><CheckCircle2/>{entry.title}</span>)}</div></section>}</div>}
      </section>

      {expenseOpen && <div className="expenseBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !expenseBusy) setExpenseOpen(false); }}><form className="expenseDialog" onSubmit={addExpense}><small>NUOVA SPESA</small><h2>Aggiungi una spesa</h2><label>Descrizione<input name="label" maxLength={240} required autoFocus/></label><div><label>Importo<input name="amount" inputMode="decimal" required/></label><label>Valuta<select name="currency" defaultValue="EUR"><option>EUR</option><option>UZS</option><option>USD</option><option>GBP</option></select></label></div><label>Giornata<select name="dayId" defaultValue={day?.id || ""}><option value="">Generale</option>{experience.days.map((entry) => <option value={entry.id} key={entry.id}>Giorno {entry.number} · {entry.city}</option>)}</select></label>{expenseError && <p className="travelError">{expenseError}</p>}<footer><button type="button" onClick={() => setExpenseOpen(false)} disabled={expenseBusy}>Annulla</button><button type="submit" disabled={expenseBusy}>{expenseBusy ? <LoaderCircle className="spin"/> : <Plus/>} Salva</button></footer></form></div>}
    </main>
  );
}
