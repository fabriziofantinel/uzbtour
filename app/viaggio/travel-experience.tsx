"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Banknote, BedDouble, Building2, Bus,
  CalendarDays, Camera, ChevronRight, CircleAlert, CircleUserRound, Clock3,
  Download, ExternalLink, House, Info, Languages, LoaderCircle, LogOut, Map,
  MapPin, MessageCircle, Navigation, Plane, Plus, ReceiptText, ShieldCheck,
  Sparkles, TrainFront, Utensils, Wallet,
} from "lucide-react";
import ExpenseDialog from "@/components/expense-dialog";
import Phrasebook from "@/components/phrasebook";
import PwaInstaller from "@/components/pwa-installer";
import TripOverviewMap, { type TripMapDay } from "@/components/trip-overview-map";
import UsefulInfo from "@/components/useful-info";
import { uploadPrivateFile } from "@/lib/private-upload-client";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";

type Tab = "oggi" | "mappa" | "programma" | "ricordi" | "spese" | "info" | "assicurazione" | "frasario" | "sfide";
type Day = Experience["days"][number];
const colors = ["#D6663D", "#715C9D", "#C4902F", "#177A78", "#3D8B68", "#A35D55"];
const som = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function dateParts(value: string) {
  if (!value) return { day: "--", month: "---", full: "Data da confermare" };
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("it-IT", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" }).format(date).replace(".", "").toUpperCase(),
    full: new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(date),
  };
}
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase(); }
function dayTransport(day: Day) {
  const types = day.items.map((item) => item.type);
  if (types.includes("flight")) return { Icon: Plane, label: "Volo" };
  if (types.includes("train")) return { Icon: TrainFront, label: "Treno" };
  if (types.includes("transport")) return { Icon: Bus, label: "Trasferimento" };
  return { Icon: Navigation, label: "Visite" };
}
function numberValue(value: string | null) {
  if (value == null || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function challengeText(content: unknown) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const item = content as Record<string, unknown>;
  return String(item.description || item.instructions || item.question || item.clue || "");
}

export default function TravelExperience({ initialExperience, userName, isAgencyAdmin = false }: {
  initialExperience: Experience; userName: string; isAgencyAdmin?: boolean;
}) {
  const [experience, setExperience] = useState(initialExperience);
  const [tab, setTab] = useState<Tab>("oggi");
  const [active, setActive] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return Math.max(0, experience.days.findIndex((day) => day.date === today));
  });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [expenseDayId, setExpenseDayId] = useState<string | null | undefined>(undefined);
  const day = experience.days[active] ?? experience.days[0];
  const photosByDay = useMemo(() => experience.photos.reduce<Record<number, Experience["photos"]>>((all, photo) => {
    all[photo.dayNumber] = [...(all[photo.dayNumber] || []), photo]; return all;
  }, {}), [experience.photos]);
  const totals = useMemo(() => experience.expenses.reduce((sum, expense) => {
    if (expense.currency === "EUR" || expense.currency === "UZS") sum[expense.currency] += expense.amount;
    return sum;
  }, { EUR: 0, UZS: 0 }), [experience.expenses]);
  const dayTotals = useMemo(() => experience.expenses.reduce((sum, expense) => {
    if (expense.dayId === day?.id && (expense.currency === "EUR" || expense.currency === "UZS")) sum[expense.currency] += expense.amount;
    return sum;
  }, { EUR: 0, UZS: 0 }), [day?.id, experience.expenses]);
  const tripMapDays = useMemo<TripMapDay[]>(() => experience.days.flatMap((entry, index) => {
    const city = entry.cities.find((candidate) => candidate.latitude != null && candidate.longitude != null);
    return city ? [{ index, n: entry.number, date: dateParts(entry.date).full, city: entry.city || city.name,
      title: entry.title, lat: city.latitude!, lon: city.longitude!, color: colors[index % colors.length] }] : [];
  }), [experience.days]);

  function openDay(index: number) { setActive(index); setTab("programma"); }
  async function postJournal(body: Record<string, unknown>) {
    const response = await fetch("/api/traveler/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, ...body }) });
    const result = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
    return result;
  }
  async function saveNote() {
    if (!day) return;
    const note = experience.notes.find((entry) => entry.dayId === day.id);
    setSaving(`note-${day.id}`); setError("");
    try {
      const result = await postJournal({ action: "note", dayId: day.id, text: note?.text || "" }) as { note: { id: string; updatedAt: string } };
      setExperience((current) => ({ ...current, notes: current.notes.map((entry) => entry.dayId === day.id ? { ...entry, id: result.note.id, updatedAt: result.note.updatedAt } : entry) }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nota non salvata"); }
    finally { setSaving(""); }
  }
  async function addRestaurant() {
    if (!day) return;
    const name = prompt("Nome del locale?")?.trim(); if (!name) return;
    setSaving("restaurant"); setError("");
    try {
      const result = await postJournal({ action: "restaurant", dayId: day.id, name }) as { restaurant: { id: string; createdAt: string } };
      setExperience((current) => ({ ...current, restaurants: [{ id: result.restaurant.id, dayId: day.id, dayNumber: day.number, name, addedBy: userName, createdAt: result.restaurant.createdAt }, ...current.restaurants] }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Locale non salvato"); }
    finally { setSaving(""); }
  }
  async function addCash(kind: "withdrawal" | "exchange") {
    if (!day) return;
    const localRaw = prompt(kind === "withdrawal" ? "Importo prelevato in valuta locale?" : "Importo ricevuto in valuta locale?");
    if (localRaw == null) return;
    const localAmount = numberValue(localRaw);
    const euroRaw = prompt(kind === "withdrawal" ? "Importo addebitato in euro? Lascia vuoto se non disponibile." : "Importo cambiato in euro?");
    if (euroRaw == null) return;
    const euroAmount = numberValue(euroRaw);
    const feeRaw = kind === "withdrawal" ? prompt("Commissione bancaria in euro? Lascia vuoto se assente.") : "";
    if (feeRaw == null) return;
    const feeEuro = numberValue(feeRaw);
    if (!localAmount || (kind === "exchange" && !euroAmount)) { setError("Inserisci importi validi."); return; }
    setSaving("cash"); setError("");
    try {
      const result = await postJournal({ action: "cash", dayId: day.id, kind, localAmount, euroAmount, feeEuro }) as { movement: { id: string; createdAt: string } };
      setExperience((current) => ({ ...current, cashMovements: [{ id: result.movement.id, dayId: day.id, dayNumber: day.number, kind, euroAmount, localAmount, localCurrency: "UZS", feeEuro, addedBy: userName, createdAt: result.movement.createdAt }, ...current.cashMovements] }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Movimento non salvato"); }
    finally { setSaving(""); }
  }
  async function saveExpense(input: { label: string; amount: string; currency: "EUR" | "UZS" }) {
    const amount = numberValue(input.amount);
    if (!amount || amount <= 0) { setError("Inserisci un importo valido."); return false; }
    setSaving("expense"); setError("");
    try {
      const response = await fetch("/api/traveler/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: expenseDayId, label: input.label, amount, currency: input.currency }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "Spesa non salvata");
      const expenseDay = experience.days.find((entry) => entry.id === expenseDayId);
      setExperience((current) => ({ ...current, expenses: [{ id: result.id!, dayId: expenseDayId || null, dayNumber: expenseDay?.number ?? null, label: input.label, amount, currency: input.currency, paidBy: userName, createdAt: new Date().toISOString() }, ...current.expenses] }));
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Spesa non salvata"); return false; }
    finally { setSaving(""); }
  }
  async function uploadPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    if (!day) return;
    const files = [...(event.target.files || [])]; event.target.value = ""; if (!files.length) return;
    setSaving("photo"); setError("");
    try {
      for (const file of files) {
        const uploaded = await uploadPrivateFile({ endpoint: "/api/traveler/photos/upload", file, payload: { departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: day.id } });
        const response = await fetch("/api/traveler/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: day.id, objectKey: uploaded.key, originalName: file.name }) });
        const result = await response.json() as { photo?: Experience["photos"][number]; error?: string };
        if (!response.ok || !result.photo) throw new Error(result.error || "Foto non registrata");
        setExperience((current) => ({ ...current, photos: [result.photo!, ...current.photos] }));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Caricamento non riuscito"); }
    finally { setSaving(""); }
  }

  if (!day) return null;
  const currentDate = dateParts(day.date);
  const transport = dayTransport(day);
  const dayNote = experience.notes.find((entry) => entry.dayId === day.id);
  const dayRestaurants = experience.restaurants.filter((entry) => entry.dayId === day.id);
  const dayCash = experience.cashMovements.filter((entry) => entry.dayId === day.id);
  const challenges = experience.challenges.filter((entry) => entry.dayId === day.id);
  const isUzbekistan = experience.journey.destinationCountry.toLocaleLowerCase("it").includes("uzbek");

  return <main>
    <header className="topbar"><div className="brand"><span className="brandMark">SMF</span><div><strong>SMF Travel</strong><small>{experience.journey.agencyName.toUpperCase()} · {experience.journey.destinationCountry.toUpperCase()}</small></div></div><div className="tripDates"><CalendarDays/><span>{dateParts(experience.journey.startsOn).full} — {dateParts(experience.journey.endsOn).full}</span><i>{experience.days.length} gg</i></div><div className="people"><span className="currentUser"><i>{initials(userName)}</i><b>{userName}</b></span><div className="avatars">{experience.journey.travelers.slice(0, 4).map((traveler) => <i key={traveler.name}>{initials(traveler.name)}</i>)}</div>{isAgencyAdmin && <a className="agencyButton" href="/agenzia"><Building2/><span>Agenzia</span></a>}<form action="/api/auth/logout" method="post"><button className="logoutButton"><LogOut/><span>Esci</span></button></form></div></header>
    {experience.availableJourneys.length > 1 && <nav className="journeyPicker">{experience.availableJourneys.map((journey) => <a className={journey.departureId === experience.journey.departureId ? "active" : ""} href={`/viaggio?partenza=${journey.departureId}`} key={journey.departureId}>{journey.title}<small>{dateParts(journey.startsOn).full}</small></a>)}</nav>}
    <section className="hero"><div className="heroTexture"/><div className="heroCopy"><p className="eyebrow">IL NOSTRO VIAGGIO</p><h1>{experience.journey.title}</h1><p>{experience.journey.destinationCountry} · {experience.journey.partyName}</p></div><div className="routeSummary"><div><strong>{experience.days.length}</strong><span>GIORNI</span></div><div><strong>{new Set(experience.days.flatMap((entry) => entry.cities.map((city) => city.name))).size}</strong><span>LOCALITÀ</span></div><div><strong>{experience.journey.travelers.length}</strong><span>VIAGGIATORI</span></div></div></section>
    <nav className="tabs"><button className={tab === "oggi" ? "active" : ""} onClick={() => setTab("oggi")}><House/> Oggi</button><button className={tab === "mappa" ? "active" : ""} onClick={() => setTab("mappa")}><Map/> Mappa</button><button className={tab === "programma" ? "active" : ""} onClick={() => setTab("programma")}><CalendarDays/> Programma</button><button className={tab === "ricordi" ? "active" : ""} onClick={() => setTab("ricordi")}><Camera/> Ricordi <b>{experience.photos.length}</b></button><button className={tab === "spese" ? "active" : ""} onClick={() => setTab("spese")}><Wallet/> Spese <b>€ {totals.EUR.toFixed(2)} · {som.format(totals.UZS)} UZS</b></button><button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}><Info/> Info utili</button><button className={tab === "assicurazione" ? "active" : ""} onClick={() => setTab("assicurazione")}><ShieldCheck/> Polizza</button><button className={tab === "frasario" ? "active" : ""} onClick={() => setTab("frasario")}><Languages/> Frasi</button><button className={tab === "sfide" ? "active" : ""} onClick={() => setTab("sfide")}><Sparkles/> Sfide</button></nav>
    {error && <p className="dataError" role="alert">{error}</p>}

    {tab === "oggi" && <section className="todayPage"><div className="todayHero"><div><span>{day.label || `GIORNO ${day.number}`} · {currentDate.full}</span><h2>{day.title}</h2><p>{day.city}</p></div><div className="todayHeroDay"><small>OGGI</small><strong>{currentDate.day}</strong><span>{currentDate.month}</span></div></div><section className="nextAppointment"><span><Clock3/></span><div><small>PROSSIMO APPUNTAMENTO</small><h3>{day.items[0]?.title || "Giornata libera"}</h3><p>{day.items[0]?.startsAt || "Orario da confermare"} · {day.city}</p></div><button onClick={() => setTab("programma")}><ChevronRight/></button></section><div className="todayInfoGrid"><article><span><Navigation/></span><small>PROGRAMMA</small><strong>{day.items.length} attività</strong><p>{transport.label}</p></article><article><span><BedDouble/></span><small>HOTEL</small><strong>{day.hotels[0]?.name || "Da confermare"}</strong><p>{day.hotels[0]?.city || day.city}</p></article><article><span><Wallet/></span><small>SPESE DI TAPPA</small><strong>€ {dayTotals.EUR.toFixed(2)}</strong><p>{som.format(dayTotals.UZS)} UZS</p></article><article><span><Camera/></span><small>RICORDI</small><strong>{photosByDay[day.number]?.length || 0} foto</strong><p>caricate per questa giornata</p></article></div><div className="todayActions"><button onClick={() => setTab("programma")}><Navigation/><span>Apri programma<small>Tutti i dettagli</small></span><ChevronRight/></button><button onClick={() => setTab("ricordi")}><Camera/><span>Ricordi del giorno<small>Foto della famiglia</small></span><ChevronRight/></button><button onClick={() => setTab("sfide")}><Sparkles/><span>Sfide del giorno<small>Quiz, missioni e giochi</small></span><ChevronRight/></button></div><PwaInstaller/><section className="todaySchedule"><div><Navigation/><span><small>PROGRAMMA RAPIDO</small><h3>La giornata in un colpo d’occhio</h3></span></div>{day.items.map((item, index) => <article key={item.id}><time>{item.startsAt || String(index + 1).padStart(2, "0")}</time><span/><strong>{item.title}</strong></article>)}<button onClick={() => setTab("programma")}><ReceiptText/> Apri tutti i dettagli</button></section></section>}

    {tab === "mappa" && <section className="overviewPage"><div className="overviewHead"><div><span>LA ROTTA DEL VIAGGIO</span><h2>{experience.days.length} giorni, una mappa</h2><p>Tocca un numero sulla mappa o una tappa qui sotto per aprire il programma.</p></div><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(experience.journey.destinationCountry)}`} target="_blank" rel="noreferrer">Apri la mappa completa <ExternalLink/></a></div>{tripMapDays.length > 0 ? <><div className="overviewMap"><TripOverviewMap days={tripMapDays} onSelect={openDay}/></div><div className="overviewDayList">{tripMapDays.map((entry) => <button key={entry.n} onClick={() => openDay(entry.index)}><span style={{ background: entry.color }}>{entry.n}</span><span><small>{entry.date}</small><strong>{entry.city}</strong></span><ChevronRight/></button>)}</div></> : <div className="empty"><Map/><h3>Mappa in preparazione</h3><p>Le località non hanno ancora coordinate validate.</p></div>}</section>}

    {tab === "programma" && <div className="dashboard"><aside className="timeline"><div className="sectionTitle"><div><span>ITINERARIO</span><h2>Giorno per giorno</h2></div><span>{active + 1} / {experience.days.length}</span></div><div className="dayList">{experience.days.map((entry, index) => { const date = dateParts(entry.date); const Transport = dayTransport(entry).Icon; return <button key={entry.id} className={`dayRow ${active === index ? "selected" : ""}`} onClick={() => setActive(index)}><span className="dayDate"><b>{date.day}</b>{date.month}</span><span className="line"><i style={{ background: colors[index % colors.length] }}/></span><span className="dayInfo"><small>{entry.label || `GIORNO ${entry.number}`}</small><strong>{entry.city}</strong><em><Transport/>{entry.title}</em></span><ChevronRight/></button>; })}</div></aside><section className="detail"><div className="detailHead"><div><span className="tag" style={{ color: colors[active % colors.length] }}>{day.label || `GIORNO ${day.number}`} · {currentDate.full}</span><h2>{day.title}</h2><p><MapPin/><span className="cityLinks">{day.cities.length ? day.cities.map((city, index) => <Fragment key={city.id}>{index > 0 && <ArrowRight/>}<a href={city.googleUrl} target="_blank" rel="noreferrer">{city.name}<ExternalLink/></a></Fragment>) : day.city}</span></p></div><div className="pager"><button disabled={active === 0} onClick={() => setActive(active - 1)}><ArrowLeft/></button><button disabled={active === experience.days.length - 1} onClick={() => setActive(active + 1)}><ArrowRight/></button></div></div><p className="description">{day.description}</p><div className="stayInfo"><span><CircleUserRound/>{transport.label}</span><span><BedDouble/><strong>{day.hotels.map((hotel) => hotel.name).join(" · ") || "Pernottamento da confermare"}</strong></span></div><div className="activityGrid"><div className="activities"><h3>Da non perdere</h3>{day.sites.map((site, index) => <a key={site.id} href={site.googleUrl} target="_blank" rel="noreferrer"><span>{String(index + 1).padStart(2, "0")}</span><strong>{site.name}</strong><ExternalLink/></a>)}{day.sites.length === 0 && day.items.map((item, index) => <a key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong></a>)}</div>{day.cities[0] && <div className="mapCard"><iframe title={`Mappa di ${day.city}`} src={`https://www.google.com/maps?q=${encodeURIComponent(day.city)}&output=embed`}/><a href={day.cities[0].googleUrl} target="_blank" rel="noreferrer"><MapPin/> Apri la mappa <ExternalLink/></a></div>}</div><div className="journal"><div><MessageCircle/><strong>Nota del giorno</strong></div><textarea placeholder="Scrivi qui un ricordo, un consiglio, una curiosità…" value={dayNote?.text || ""} onChange={(event) => setExperience((current) => ({ ...current, notes: current.notes.some((entry) => entry.dayId === day.id) ? current.notes.map((entry) => entry.dayId === day.id ? { ...entry, text: event.target.value, updatedBy: userName } : entry) : [...current.notes, { id: "new", dayId: day.id, dayNumber: day.number, text: event.target.value, updatedBy: userName, updatedAt: "" }] }))} onBlur={() => void saveNote()}/>{saving === `note-${day.id}` ? <small className="auditBy">Salvataggio…</small> : dayNote?.text && <small className="auditBy">Ultima modifica: {dayNote.updatedBy}</small>}</div><div className="quickActions"><label className={saving === "photo" ? "disabled" : ""}>{saving === "photo" ? <LoaderCircle className="spin"/> : <Camera/>}<span>Aggiungi foto<small>{photosByDay[day.number]?.length || 0} caricate</small></span><Plus/><input type="file" accept="image/*,.heic,.heif" multiple disabled={saving === "photo"} onChange={(event) => void uploadPhotos(event)}/></label><button onClick={() => void addRestaurant()}><Utensils/><span>Aggiungi locale<small>{dayRestaurants.length} salvati</small></span><Plus/></button><button onClick={() => setExpenseDayId(day.id)}><ReceiptText/><span>Aggiungi spesa<small>Tappa: € {dayTotals.EUR.toFixed(2)} · {som.format(dayTotals.UZS)} UZS</small></span><Plus/></button><button onClick={() => void addCash("withdrawal")}><Banknote/><span>Aggiungi prelievo<small>{dayCash.filter((item) => item.kind === "withdrawal").length} registrati</small></span><Plus/></button><button onClick={() => void addCash("exchange")}><ArrowRightLeft/><span>Aggiungi cambio<small>{dayCash.filter((item) => item.kind === "exchange").length} registrati</small></span><Plus/></button></div>{dayRestaurants.length > 0 && <div className="restaurantList">{dayRestaurants.map((restaurant) => <span key={restaurant.id}><Utensils/><b>{restaurant.name}</b><small>Aggiunto da {restaurant.addedBy}</small></span>)}</div>}</section></div>}

    {tab === "ricordi" && <section className="collection"><div className="sectionTitle"><div><span>DIARIO VISIVO</span><h2>I nostri ricordi</h2></div></div>{experience.photos.length === 0 ? <div className="empty"><Camera/><h3>La galleria aspetta il primo ricordo</h3><p>Apri una giornata del programma e aggiungi le tue foto.</p><button onClick={() => setTab("programma")}>Vai al programma</button></div> : <div className="photoGrid">{experience.photos.map((photo) => <figure key={photo.id}><img src={photo.contentUrl} alt={photo.originalName} loading="lazy"/><div className="photoActions"><a href={photo.downloadUrl}><Download/></a></div><figcaption>Giorno {photo.dayNumber} · {photo.addedBy}</figcaption></figure>)}</div>}</section>}

    {tab === "spese" && <section className="collection expensesPage"><div className="expenseHero"><span>SPESE DELLA FAMIGLIA</span><h2>Totali per valuta</h2><div className="expenseCurrencyTotals"><div><small>EURO</small><strong>€ {totals.EUR.toFixed(2)}</strong></div><div><small>VALUTA LOCALE</small><strong>{som.format(totals.UZS)} UZS</strong></div></div><p>Famiglia: {experience.journey.partyName}</p></div><div className="expenseList">{experience.expenses.map((expense) => <div key={expense.id}><span className="receipt"><ReceiptText/></span><span><strong>{expense.label}</strong><small>Pagato da {expense.paidBy}{expense.dayNumber ? ` · Giorno ${expense.dayNumber}` : ""}</small></span><b>{expense.currency === "EUR" ? `€ ${expense.amount.toFixed(2)}` : `${som.format(expense.amount)} ${expense.currency}`}</b></div>)}</div><button className="primary" onClick={() => setExpenseDayId(null)}><Plus/> Nuova spesa</button><div className="cashSection"><div className="sectionTitle"><div><span>GESTIONE CONTANTI</span><h2>Prelievi e cambi</h2></div></div>{experience.cashMovements.length === 0 ? <p className="cashEmpty">Nessun prelievo o cambio registrato.</p> : <div className="cashMovementList">{experience.cashMovements.map((movement) => <div key={movement.id}><span className={`cashIcon ${movement.kind}`}><Banknote/></span><span><strong>{movement.kind === "withdrawal" ? "Prelievo ATM" : "Cambio valuta"}</strong><small>Giorno {movement.dayNumber} · Inserito da {movement.addedBy}</small></span><b>{movement.euroAmount != null && <small>€ {movement.euroAmount.toFixed(2)}</small>}{som.format(movement.localAmount)} {movement.localCurrency}</b></div>)}</div>}</div></section>}

    {tab === "info" && (isUzbekistan ? <UsefulInfo/> : <section className="usefulPage"><header className="usefulHero"><span>PRONTI A PARTIRE</span><h2>Informazioni utili</h2><p>Contatti e consigli pratici sempre a portata di mano.</p></header><section className="infoSection"><div className="infoSectionHead"><Info/><div><small>{experience.journey.destinationCountry}</small><h3>Tutto ciò che serve sapere</h3></div></div><div className="cultureGrid">{experience.usefulInfo.map((item, index) => <article key={`${item.title}-${index}`}><Info/><h4>{item.title}</h4><p>{item.body}</p>{item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">Approfondisci <ExternalLink/></a>}</article>)}</div></section></section>)}
    {tab === "assicurazione" && <section className="insurancePage"><header className="insuranceHero"><div className="insuranceHeroIcon"><ShieldCheck/></div><div><span>DOCUMENTI DEL VIAGGIO</span><h2>Assicurazione di viaggio</h2><p>Polizza, assistenza e contatti di emergenza della famiglia.</p></div><b>AREA RISERVATA</b></header><section className="insuranceSection"><div className="insuranceSectionHead"><ShieldCheck/><div><small>POLIZZA</small><h3>Documento non ancora caricato</h3></div></div><div className="insuranceWarning"><CircleAlert/><p>L’agenzia non ha ancora associato una polizza a questa partenza. Quando sarà disponibile, appariranno qui numero, coperture, assicurati e contatti.</p></div></section></section>}
    {tab === "frasario" && (isUzbekistan ? <Phrasebook/> : <section className="phrasebookPage"><header className="phrasebookHero"><span><Languages/></span><div><small>PAROLE UTILI</small><h2>Frasario da viaggio</h2><p>Le parole giuste per salutare, ordinare, spostarsi e chiedere aiuto.</p></div></header><div className="languageNote">Pronuncia semplificata e traduzione italiana, preparate per <strong>{experience.journey.destinationCountry}</strong>.</div><div className="phraseList">{experience.phrases.map((phrase, index) => <article key={`${phrase.term}-${index}`}><span className="phraseCategory">{phrase.category}</span><h3>{phrase.translation}</h3><div className="phraseTranslations"><div><small>{phrase.language}</small><strong>{phrase.term}</strong><em>{phrase.pronunciation}</em></div></div></article>)}</div></section>)}
    {tab === "sfide" && <section className="challengesPage"><header className="challengesHero"><div><span>GIOCA E SCOPRI</span><h2>Le sfide del viaggio</h2><p>Quiz, missioni, giochi, bingo e contest creati sulle visite del programma.</p></div><Sparkles/></header><div className="gamesDayPicker">{experience.days.map((entry, index) => <button className={active === index ? "active" : ""} onClick={() => setActive(index)} key={entry.id}><small>GIORNO {entry.number}</small><strong>{entry.city}</strong><b>{experience.challenges.filter((challenge) => challenge.dayId === entry.id).length} sfide</b></button>)}</div><section className="missionsSection"><div className="missionDayHeading"><div><small>GIORNO {day.number}</small><h3>{day.city}</h3></div></div><div className="missionGrid">{challenges.map((challenge) => <article className="missionCard" key={challenge.id}><div className="missionIcon"><Sparkles/></div><small>{challenge.type.replaceAll("_", " ")}</small><h4>{challenge.title}</h4><p>{challengeText(challenge.content)}</p></article>)}</div>{challenges.length === 0 && <div className="empty"><Sparkles/><h3>Sfide in preparazione</h3><p>I contenuti di questa giornata non sono ancora disponibili.</p></div>}</section></section>}
    <ExpenseDialog open={expenseDayId !== undefined} dayLabel={expenseDayId ? currentDate.full : undefined} saving={saving === "expense"} onClose={() => setExpenseDayId(undefined)} onSave={saveExpense}/>
  </main>;
}
