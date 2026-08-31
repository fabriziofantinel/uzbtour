"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Accessibility, ArrowLeft, ArrowRight, ArrowRightLeft, Banknote, BedDouble, Building2, Bus,
  CalendarDays, Camera, ChevronRight, CircleUserRound, Clock3,
  Check, Download, ExternalLink, FileText, Info, Languages, LoaderCircle, LogOut, Map,
  MapPin, MessageCircle, Navigation, Plane, ReceiptText,
  Phone, Share2, ShieldAlert, Sparkles, Star, TrainFront, Trash2, Utensils, Wallet, Wifi, WifiOff,
} from "lucide-react";
import ExpenseDialog from "@/components/expense-dialog";
import CashMovementDialog from "@/components/cash-movement-dialog";
import type { TripMapDay } from "@/components/trip-overview-map";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";
import { agencyLogoSource } from "@/lib/platform/branding-ui";
import { resilientMutation, uuidV7 } from "@/lib/pwa/offline-queue";
import PwaCompanion from "@/components/pwa-companion";
import OperationalChat from "@/components/operational-chat";
import { downloadTripForOffline, type OfflinePackageState } from "@/lib/pwa/offline-package";

const TripOverviewMap = dynamic(() => import("@/components/trip-overview-map"), {
  ssr: false,
  loading: () => <div className="componentLoading" role="status">Caricamento della mappa…</div>,
});
const PlatformTripChallenges = dynamic(() => import("@/components/platform-trip-challenges"), {
  loading: () => <div className="componentLoading" role="status">Caricamento delle sfide…</div>,
});

type Tab = "mappa" | "programma" | "ricordi" | "documenti" | "spese" | "info" | "frasario" | "sfide" | "sos" | "chat";
type Day = Experience["days"][number];
const colors = ["#D6663D", "#715C9D", "#C4902F", "#177A78", "#3D8B68", "#A35D55"];
const som = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const usefulSections = [
  { key: "numeri di emergenza", title: "Numeri di emergenza" }, { key: "ambasciata", title: "Ambasciata" },
  { key: "salute", title: "Salute" }, { key: "documenti", title: "Documenti" },
  { key: "abbigliamento", title: "Abbigliamento" }, { key: "usi locali", title: "Usi locali" },
  { key: "come muoversi", title: "Come muoversi" }, { key: "usi e tradizioni", title: "Usi e tradizioni" },
  { key: "capire il paese", title: "Capire il paese" },
] as const;
function destinationCurrency(country: string) {
  const value = country.toLocaleLowerCase("it");
  if (value.includes("vietnam")) return "VND";
  if (value.includes("uzbek")) return "UZS";
  return "EUR";
}
function formatClock(timeZone: string, now: Date) {
  try { return new Intl.DateTimeFormat("it-IT", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now); }
  catch { return "--:--"; }
}
function destinationTimeZone(country: string, configured: string) {
  const value = country.toLocaleLowerCase("it");
  if (value.includes("vietnam")) return "Asia/Ho_Chi_Minh";
  if (value.includes("uzbek")) return "Asia/Tashkent";
  return configured;
}

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
function exchangeRateLabel(euroAmount: number | null, localAmount: number, localCurrency: string) {
  if (!euroAmount || euroAmount <= 0) return "Cambio non disponibile";
  return `1 € = ${som.format(localAmount / euroAmount)} ${localCurrency}`;
}
function challengeText(content: unknown) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const item = content as Record<string, unknown>;
  return String(item.description || item.instructions || item.question || item.clue || "");
}

function validBrandColor(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#247A6B";
}

function todayInTimeZone(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

function currentDayIndex(days: Experience["days"], timeZone: string) {
  const today = todayInTimeZone(timeZone);
  const index = days.findIndex((entry) => entry.date === today);
  return index >= 0 ? index : 0;
}

function itemPresentation(type: string) {
  if (type === "meal") return { Icon: Utensils, label: "Pasto" };
  if (type === "visit") return { Icon: MapPin, label: "Visita" };
  if (type === "transport") return { Icon: Bus, label: "Trasferimento" };
  if (type === "flight") return { Icon: Plane, label: "Volo" };
  if (type === "train") return { Icon: TrainFront, label: "Treno" };
  if (type === "hotel") return { Icon: BedDouble, label: "Hotel" };
  if (type === "meeting") return { Icon: CircleUserRound, label: "Incontro" };
  if (type === "document") return { Icon: FileText, label: "Documento" };
  return { Icon: Navigation, label: "Attività" };
}

function relatedSite(day: Day, item: Day["items"][number]) {
  if (item.type !== "visit") return null;
  const normalizedTitle = item.title.toLocaleLowerCase("it").replace(/[^a-z0-9à-ÿ]+/g, " ").trim();
  const matched = day.sites.find((site) => {
    const name = site.name.toLocaleLowerCase("it").replace(/[^a-z0-9à-ÿ]+/g, " ").trim();
    return name === normalizedTitle || name.includes(normalizedTitle) || normalizedTitle.includes(name);
  });
  if (matched) return matched;
  const visitIndex = day.items.filter((entry) => entry.type === "visit").findIndex((entry) => entry.id === item.id);
  return visitIndex >= 0 ? day.sites[visitIndex] ?? null : null;
}

function normalizedLocation(value: string) {
  return value.toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function mapCityForDay(day: Day) {
  const cities = day.cities.filter((city) => city.latitude != null && city.longitude != null);
  if (cities.length <= 1) return cities[0] ?? null;

  const dayCity = normalizedLocation(day.city);
  const exactDayCity = cities.find((city) => normalizedLocation(city.name) === dayCity);
  if (exactDayCity) return exactDayCity;

  const hotelCities = day.hotels.map((hotel) => normalizedLocation(hotel.city)).filter(Boolean);
  const overnightCity = cities.find((city) => hotelCities.includes(normalizedLocation(city.name)));
  if (overnightCity) return overnightCity;

  const routeText = normalizedLocation(`${day.city} ${day.title}`);
  const mentionedCities = cities.map((city) => ({ city, position: routeText.lastIndexOf(normalizedLocation(city.name)) }))
    .filter((entry) => entry.position >= 0)
    .sort((left, right) => right.position - left.position);
  return mentionedCities[0]?.city ?? cities[0];
}

function RatingStars({ value, busy, label, onRate }: {
  value: number | null; busy: boolean; label: string; onRate: (rating: number) => void;
}) {
  return <div className="programmeRating"><span>{value ? "La tua valutazione" : "Valuta questa tappa"}</span><div role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} className={value != null && rating <= value ? "active" : ""} disabled={busy} onClick={() => onRate(rating)} aria-label={`${rating} ${rating === 1 ? "stella" : "stelle"}`} aria-pressed={value === rating}><Star/></button>)}</div>{busy && <LoaderCircle className="spin"/>}</div>;
}

export default function TravelExperience({ initialExperience, userName, isAgencyAdmin = false }: {
  initialExperience: Experience; userName: string; isAgencyAdmin?: boolean;
}) {
  const [experience, setExperience] = useState(initialExperience);
  const [tab, setTab] = useState<Tab>("programma");
  const [active, setActive] = useState(() => currentDayIndex(initialExperience.days, initialExperience.journey.timezone));
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [officialEurRate, setOfficialEurRate] = useState<number | null>(null);
  const [expenseDayId, setExpenseDayId] = useState<string | null | undefined>(undefined);
  const [cashDialogKind, setCashDialogKind] = useState<"withdrawal" | "exchange" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [memoryDayFilter, setMemoryDayFilter] = useState<number | "all">("all");
  const [isOnline, setIsOnline] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [offlinePackage,setOfflinePackage]=useState<OfflinePackageState>("idle");
  const [offlineProgress,setOfflineProgress]=useState({done:0,total:0});
  const [largeText,setLargeText]=useState(false);
  const [simpleMode,setSimpleMode]=useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const firstTabRender = useRef(true);
  const gestureStart = useRef<{ x: number; y: number; atTop: boolean } | null>(null);
  const day = experience.days[active] ?? experience.days[0];
  const photosByDay = useMemo(() => experience.photos.reduce<Record<number, Experience["photos"]>>((all, photo) => {
    all[photo.dayNumber] = [...(all[photo.dayNumber] || []), photo]; return all;
  }, {}), [experience.photos]);
  const memoryDays = useMemo(() => Object.keys(photosByDay).map(Number).sort((left, right) => left - right), [photosByDay]);
  const visiblePhotos = useMemo(() => memoryDayFilter === "all"
    ? experience.photos
    : experience.photos.filter((photo) => photo.dayNumber === memoryDayFilter), [experience.photos, memoryDayFilter]);
  const travelDocuments = useMemo(() => experience.days.flatMap((entry) => [
    ...entry.documents.map((document) => ({
      ...document, dayNumber: entry.number, dayDate: entry.date, dayTitle: entry.title,
      itemTitle: document.description || "Documento della giornata", itemType: "document",
    })),
    ...entry.items.flatMap((item) => item.tickets.map((ticket) => ({
      ...ticket, dayNumber: entry.number, dayDate: entry.date, dayTitle: entry.title,
      itemTitle: item.title, itemType: item.type,
    }))),
  ]), [experience.days]);
  const localCurrency = destinationCurrency(experience.journey.destinationCountry);
  const localTimeZone = destinationTimeZone(experience.journey.destinationCountry, experience.journey.timezone);
  const displayedUsefulInfo = useMemo(() => usefulSections.map((section) => {
    const item = experience.usefulInfo.find((candidate) => `${candidate.category} ${candidate.title}`.toLocaleLowerCase("it").includes(section.key));
    return { title: section.title, body: item?.body || "Informazione in aggiornamento da parte dell’agenzia.", phone: item?.phone || "",
      sourceName:item?.sourceName||"",sourceUrl:item?.sourceUrl||item?.url||"",verifiedAt:item?.verifiedAt||"",
      reviewStatus:item?.reviewStatus||"needs_review",disclaimer:item?.disclaimer||"" };
  }), [experience.usefulInfo]);

  async function acknowledgeNotice(noticeId:string){
    setSaving(`notice-${noticeId}`);setError("");
    try{const response=await fetch("/api/traveler/change-notices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({noticeId,clientOperationId:uuidV7()})});if(!response.ok)throw new Error("Presa visione non registrata");setExperience(current=>({...current,changeNotices:current.changeNotices.map(notice=>notice.id===noticeId?{...notice,readAt:new Date().toISOString()}:notice)}));}
    catch(caught){setError(caught instanceof Error?caught.message:"Presa visione non registrata");}finally{setSaving("");}
  }
  const localFormatter = useMemo(() => new Intl.NumberFormat("it-IT", { maximumFractionDigits: localCurrency === "VND" ? 0 : 2 }), [localCurrency]);
  const totals = useMemo(() => experience.expenses.reduce((sum, expense) => {
    if (expense.currency === "EUR") sum.EUR += expense.amount;
    else if (expense.currency === localCurrency) sum.local += expense.amount;
    return sum;
  }, { EUR: 0, local: 0 }), [experience.expenses, localCurrency]);
  const appliedEurRate = useMemo(() => {
    const converted = experience.cashMovements.filter((movement) => movement.euroAmount != null && movement.euroAmount > 0);
    const euro = converted.reduce((sum, movement) => sum + (movement.euroAmount || 0), 0);
    const local = converted.reduce((sum, movement) => sum + movement.localAmount, 0);
    return euro > 0 && local > 0 ? local / euro : officialEurRate;
  }, [experience.cashMovements, officialEurRate]);
  const totalSpentEuro = useMemo(() => {
    let total = 0;
    for (const expense of experience.expenses) {
      if (expense.baseAmount != null) total += expense.baseAmount;
      else if (expense.currency === "EUR") total += expense.amount;
      else if (expense.currency === localCurrency && appliedEurRate) total += expense.amount / appliedEurRate;
      else return null;
    }
    return total;
  }, [appliedEurRate, experience.expenses, localCurrency]);
  const expenseBalances = useMemo(() => experience.journey.travelers.map((traveler) => {
    let paid=0,owed=0;
    for(const expense of experience.expenses){
      const base=expense.baseAmount ?? (expense.currency==="EUR"?expense.amount:0);
      if(expense.paidByTravelerId===traveler.id)paid+=base;
      const share=expense.shares.find((entry)=>entry.travelerId===traveler.id);
      if(share)owed+=share.baseAmount;
      else if(expense.shares.length===0)owed+=base/Math.max(experience.journey.travelers.length,1);
    }
    return {id:traveler.id,name:traveler.name,balance:paid-owed};
  }),[experience.expenses,experience.journey.travelers]);
  const operationalPoints = useMemo<TripMapDay[]>(() => {
    const points = [
      ...day.items.filter((item) => item.latitude != null && item.longitude != null).map((item) => ({ title: item.title, city: day.city || item.title, lat: item.latitude!, lon: item.longitude! })),
      ...day.sites.filter((site) => site.latitude != null && site.longitude != null).map((site) => ({ title: site.name, city: site.city || day.city, lat: site.latitude!, lon: site.longitude! })),
      ...day.hotels.filter((hotel) => hotel.latitude != null && hotel.longitude != null).map((hotel) => ({ title: hotel.name, city: hotel.city || day.city, lat: hotel.latitude!, lon: hotel.longitude! })),
    ];
    return [...new globalThis.Map(points.map((point) => [`${point.lat}:${point.lon}:${point.title}`, point] as const)).values()].map((point, index) => ({ index, n: index + 1, date: dateParts(day.date).full, color: colors[index % colors.length], ...point }));
  }, [day]);

  function trackAnalytics(eventName:"traveler_session"|"programme_view"|"document_list_view"|"document_download",properties:Record<string,string|number|boolean|null>={}){
    try{
      const sessionKey="smf-analytics-session";let sessionId=sessionStorage.getItem(sessionKey);
      if(!sessionId){sessionId=uuidV7();sessionStorage.setItem(sessionKey,sessionId);}
      const dedupeKey=`smf-analytics:${sessionId}:${experience.journey.departureId}:${eventName}:${properties.documentId??day.id}`;
      if(sessionStorage.getItem(dedupeKey))return;sessionStorage.setItem(dedupeKey,"1");
      void fetch("/api/traveler/analytics",{method:"POST",headers:{"Content-Type":"application/json"},keepalive:true,body:JSON.stringify({
        departureId:experience.journey.departureId,partyId:experience.journey.partyId,
        dayId:day?.id??null,eventName,sessionId,clientOperationId:uuidV7(),properties,
      })}).then((response)=>{if(!response.ok)sessionStorage.removeItem(dedupeKey);}).catch(()=>sessionStorage.removeItem(dedupeKey));
    }catch{/* Le analytics non devono interrompere l'esperienza di viaggio. */}
  }

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/exchange-rate?currency=${encodeURIComponent(localCurrency)}`).then((response) => response.ok ? response.json() : null)
      .then((result: { rate?: number } | null) => {
        if (activeRequest && result?.rate && Number.isFinite(result.rate)) setOfficialEurRate(result.rate);
      }).catch(() => undefined);
    return () => { activeRequest = false; };
  }, [localCurrency]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(()=>{setLargeText(localStorage.getItem("smf-large-text")==="1");setSimpleMode(localStorage.getItem("smf-simple-mode")==="1");},[]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (["programma", "documenti", "spese", "mappa", "sfide", "info", "frasario", "sos", "chat"].includes(requestedTab || "")) setTab(requestedTab as Tab);
  }, []);

  useEffect(()=>{
    trackAnalytics("traveler_session",{entryTab:tab});
    if(tab==="programma")trackAnalytics("programme_view",{dayNumber:day.number});
    if(tab==="documenti")trackAnalytics("document_list_view",{documentCount:travelDocuments.length});
    // Il tracciamento è intenzionalmente legato all'apertura della sezione, non allo scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,day.id,experience.journey.departureId]);

  useEffect(() => {
    const updateConnectionState = () => setIsOnline(navigator.onLine);
    updateConnectionState();
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    return () => {
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, []);

  useEffect(() => {
    if (firstTabRender.current) {
      firstTabRender.current = false;
      return;
    }
    contentRef.current?.focus({ preventScroll: true });
  }, [tab]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!moreMenuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    moreMenuRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [moreOpen]);

  function selectDay(index: number) {
    setActive(index);
  }
  function openDay(index: number) { selectDay(index); setTab("programma"); }
  function openProgramme() {
    selectDay(currentDayIndex(experience.days, experience.journey.timezone));
    setTab("programma");
  }
  async function postJournal(body: Record<string, unknown>) {
    const payload: Record<string, unknown> = { departureId: experience.journey.departureId, partyId: experience.journey.partyId, ...body };
    const offlineKind = body.action === "cash" ? "cash" : null;
    if (offlineKind) {
      const result = await resilientMutation({ kind: offlineKind, url: "/api/traveler/journal", method: "POST", body: payload });
      if (result.queued) return { queued: true, movement: { id: String(payload.clientOperationId), createdAt: new Date().toISOString() } };
      const response = result.response!;
      const responseBody = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(responseBody.error || "Salvataggio non riuscito");
      return responseBody;
    }
    const response = await fetch("/api/traveler/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
    return result;
  }
  async function saveRating(dayId: string, targetType: "itinerary_item" | "hotel", targetId: string, rating: number) {
    const busyKey = `rating-${targetType}-${targetId}`;
    setSaving(busyKey); setError("");
    try {
      const result = await resilientMutation({ kind: "feedback", url: "/api/traveler/feedback", method: "POST", body: { departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId, targetType, targetId, rating, clientOperationId: uuidV7() } });
      if (!result.queued && !result.response?.ok) throw new Error("Valutazione non salvata");
      setExperience((current) => ({ ...current, days: current.days.map((entry) => entry.id !== dayId ? entry : ({ ...entry,
        items: targetType === "itinerary_item" ? entry.items.map((item) => item.id === targetId ? { ...item, rating } : item) : entry.items,
        hotels: targetType === "hotel" ? entry.hotels.map((hotel) => hotel.id === targetId ? { ...hotel, rating } : hotel) : entry.hotels,
      })) }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Valutazione non salvata"); }
    finally { setSaving(""); }
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
  async function addCash(kind: "withdrawal" | "exchange", input: { localAmount: string; euroAmount: string }) {
    if (!day) return false;
    const localAmount = numberValue(input.localAmount);
    const euroAmount = numberValue(input.euroAmount);
    if (!localAmount || !euroAmount) { setError("Inserisci importi validi per calcolare il cambio applicato."); return false; }
    setSaving("cash"); setError("");
    try {
      const result = await postJournal({ action: "cash", dayId: day.id, kind, localAmount, euroAmount, localCurrency, feeEuro: null, clientOperationId: uuidV7() }) as { movement: { id: string; createdAt: string } };
      setExperience((current) => ({ ...current, cashMovements: [{ id: result.movement.id, dayId: day.id, dayNumber: day.number, kind, euroAmount, localAmount, localCurrency, feeEuro: null, addedBy: userName, createdAt: result.movement.createdAt }, ...current.cashMovements] }));
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Movimento non salvato"); return false; }
    finally { setSaving(""); }
  }
  async function deleteExpense(expenseId: string) {
    if (!confirm("Eliminare definitivamente questa spesa?")) return;
    const busyKey = `delete-expense-${expenseId}`;
    setSaving(busyKey); setError("");
    try {
      const response = await fetch("/api/traveler/expenses", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, expenseId }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Eliminazione della spesa non riuscita");
      setExperience((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== expenseId) }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Eliminazione della spesa non riuscita"); }
    finally { setSaving(""); }
  }
  async function deleteCashMovement(movementId: string, kind: "withdrawal" | "exchange") {
    if (!confirm(`Eliminare definitivamente ${kind === "withdrawal" ? "questo prelievo" : "questo cambio"}?`)) return;
    const busyKey = `delete-cash-${movementId}`;
    setSaving(busyKey); setError("");
    try {
      const response = await fetch("/api/traveler/journal", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, movementId }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Eliminazione del movimento non riuscita");
      setExperience((current) => ({ ...current, cashMovements: current.cashMovements.filter((movement) => movement.id !== movementId) }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Eliminazione del movimento non riuscita"); }
    finally { setSaving(""); }
  }
  async function saveExpense(input: { label: string; amount: string; currency: string; shareTravelerIds: string[] }) {
    const amount = numberValue(input.amount);
    if (!amount || amount <= 0) { setError("Inserisci un importo valido."); return false; }
    setSaving("expense"); setError("");
    try {
      const exchangeRateToBase = input.currency === "EUR" ? 1 : appliedEurRate ? 1 / appliedEurRate : null;
      const operationId = uuidV7();
      const request = await resilientMutation({ kind: "expense", url: "/api/traveler/expenses", method: "POST", body: { departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: expenseDayId, label: input.label, amount, currency: input.currency, exchangeRateToBase, shareTravelerIds: input.shareTravelerIds, clientOperationId: operationId } });
      const result = request.queued ? { id: operationId } : await request.response!.json() as { id?: string; error?: string };
      if (!request.queued && (!request.response?.ok || !result.id)) throw new Error(result.error || "Spesa non salvata");
      const expenseDay = experience.days.find((entry) => entry.id === expenseDayId);
      const baseAmount=exchangeRateToBase == null ? null : Math.round(amount * exchangeRateToBase * 10_000) / 10_000;
      const currentTraveler=experience.journey.travelers.find((traveler)=>traveler.isCurrent);
      const shareBase=baseAmount==null?0:baseAmount/input.shareTravelerIds.length;
      setExperience((current) => ({ ...current, expenses: [{ id: result.id!, dayId: expenseDayId || null, dayNumber: expenseDay?.number ?? null, label: input.label, amount, currency: input.currency, baseCurrency: "EUR", exchangeRateToBase, baseAmount, paidBy: userName,paidByTravelerId:currentTraveler?.id||"",shares:input.shareTravelerIds.map((travelerId)=>({travelerId,travelerName:experience.journey.travelers.find((traveler)=>traveler.id===travelerId)?.name||"Viaggiatore",amount:amount/input.shareTravelerIds.length,baseAmount:shareBase})), createdAt: new Date().toISOString() }, ...current.expenses] }));
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Spesa non salvata"); return false; }
    finally { setSaving(""); }
  }
  async function prepareOffline(){
    setOfflinePackage("downloading");setError("");
    const urls=[window.location.href,`/api/traveler/trip-data?partenza=${experience.journey.departureId}`,...travelDocuments.map((document)=>document.downloadUrl)];
    try{await downloadTripForOffline(urls,(done,total)=>setOfflineProgress({done,total}));setOfflinePackage("ready");}
    catch(caught){setOfflinePackage("failed");setError(caught instanceof Error?caught.message:"Download offline non riuscito");}
  }
  async function shareAlbum(){
    const url=`/api/traveler/travel-album?partenza=${encodeURIComponent(experience.journey.departureId)}`;
    try{
      const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error();
      const blob=await response.blob(),file=new File([blob],"diario-del-viaggio.pdf",{type:"application/pdf"});
      if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({title:experience.journey.title,text:"Il diario del nostro viaggio",files:[file]});
      else{const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
    }catch(caught){if(caught instanceof DOMException&&caught.name==="AbortError")return;setError("Condivisione del diario non riuscita. Riprova quando sei online.");}
  }
  function togglePreference(kind:"text"|"simple"){
    if(kind==="text")setLargeText((value)=>{localStorage.setItem("smf-large-text",value?"0":"1");return !value;});
    else setSimpleMode((value)=>{localStorage.setItem("smf-simple-mode",value?"0":"1");return !value;});
  }
  if (!day) return null;
  const currentDate = dateParts(day.date);
  const dayNote = experience.notes.find((entry) => entry.dayId === day.id);
  const agencyColor = validBrandColor(experience.journey.agencyBranding.primaryColor);
  const agencyLogo = agencyLogoSource(experience.journey.agencyBranding.logoUrl,experience.journey.agencyId);
  const brandStyle = {
    "--agency-source": agencyColor,
    "--agency-primary": agencyColor,
    "--agency-on-primary": "#111111",
    "--smf-action": agencyColor,
    "--teal": agencyColor,
    "--on-brand": "#111111",
  } as CSSProperties;

  return <main className={`travelExperience travelerRedesign${largeText?" largeTextMode":""}${simpleMode?" simpleMode":""}`} style={brandStyle} data-design-contract="b0beb44b" data-design-thesis="sentiero-delle-tappe"
    onTouchStart={(event) => { const touch = event.touches[0]; gestureStart.current = { x: touch.clientX, y: touch.clientY, atTop: window.scrollY <= 2 }; }}
    onTouchEnd={(event) => { const start = gestureStart.current; const touch = event.changedTouches[0]; gestureStart.current = null; if (!start) return; const dx = touch.clientX - start.x, dy = touch.clientY - start.y; if (start.atTop && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) { window.location.reload(); return; } if (tab === "programma" && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) selectDay(Math.max(0, Math.min(experience.days.length - 1, active + (dx < 0 ? 1 : -1)))); }}>
    <link rel="icon" href="/api/pwa/icon?size=192" sizes="192x192" type="image/png"/>
    <link rel="apple-touch-icon" href="/api/pwa/icon?size=192" sizes="192x192"/>
    <meta name="apple-mobile-web-app-title" content={experience.journey.agencyName}/>
    <link rel="apple-touch-startup-image" href="/splash/iphone-1170x2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"/>
    <link rel="apple-touch-startup-image" href="/splash/iphone-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"/>
    <link rel="apple-touch-startup-image" href="/splash/iphone-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"/>
    <PwaCompanion/>
    <a className="skipLink" href="#travel-main-content">Salta al contenuto del viaggio</a>
    <header className="topbar"><div className="brand">{agencyLogo ? <img className="agencyLogo" src={agencyLogo} alt={`Logo ${experience.journey.agencyName}`}/> : <span className="brandMark">{initials(experience.journey.agencyName)}</span>}<div><strong>{experience.journey.agencyName}</strong><small>POWERED BY SMF TRAVEL</small></div></div><div className="tripDates"><CalendarDays/><span>{dateParts(experience.journey.startsOn).full} — {dateParts(experience.journey.endsOn).full}</span><i>{experience.days.length} gg</i></div><div className="people"><span className={`connectionStatus ${isOnline ? "online" : "offline"}`} role="status" aria-live="polite">{isOnline ? <Wifi/> : <WifiOff/>}<b>{isOnline ? (saving ? "Salvataggio…" : "Online") : "Solo consultazione"}</b></span><span className="currentUser"><i>{initials(userName)}</i><b>{userName}</b></span><div className="avatars">{experience.journey.travelers.slice(0, 4).map((traveler) => <i key={traveler.name}>{initials(traveler.name)}</i>)}</div>{isAgencyAdmin && <a className="agencyButton" href="/agenzia"><Building2/><span>Agenzia</span></a>}<a className="logoutButton" href="/api/auth/logout"><LogOut/><span>Esci</span></a></div></header>
    {experience.availableJourneys.length > 1 && <nav className="journeyPicker">{experience.availableJourneys.map((journey) => <a className={journey.departureId === experience.journey.departureId ? "active" : ""} href={`/viaggio?partenza=${journey.departureId}`} key={journey.departureId}>{journey.title}<small>{dateParts(journey.startsOn).full}</small></a>)}</nav>}
    <section className="hero"><div className="heroTexture"/><div className="heroCopy"><p className="eyebrow">IL NOSTRO VIAGGIO</p><h1>{experience.journey.title}</h1><p>{experience.journey.destinationCountry} · {experience.journey.partyName}</p></div><div className="routeSummary"><div><strong>{experience.days.length}</strong><span>GIORNI</span></div><div><strong>{new Set(experience.days.flatMap((entry) => entry.cities.map((city) => city.name))).size}</strong><span>LOCALITÀ</span></div><div><strong>{experience.journey.travelers.length}</strong><span>VIAGGIATORI</span></div></div></section>
    <nav className="tabs" aria-label="Sezioni del viaggio"><button type="button" className={tab === "mappa" ? "active" : ""} aria-current={tab === "mappa" ? "page" : undefined} onClick={() => { setTab("mappa"); setMoreOpen(false); }}><Map/><span>Mappa</span></button><button type="button" className={tab === "programma" ? "active" : ""} aria-current={tab === "programma" ? "page" : undefined} onClick={() => { openProgramme(); setMoreOpen(false); }}><CalendarDays/><span>Programma</span></button><button type="button" className={tab === "documenti" ? "active" : ""} aria-current={tab === "documenti" ? "page" : undefined} onClick={() => { setTab("documenti"); setMoreOpen(false); }}><FileText/><span>Documenti</span></button><button type="button" aria-label="Spese, prelievi e cambi" className={tab === "spese" ? "active" : ""} aria-current={tab === "spese" ? "page" : undefined} onClick={() => { setTab("spese"); setMoreOpen(false); }}><Wallet/><span>Spese</span></button><button type="button" className={tab === "sfide" ? "active" : ""} aria-current={tab === "sfide" ? "page" : undefined} onClick={() => { setTab("sfide"); setMoreOpen(false); }}><Sparkles/><span>Sfide</span></button><button ref={moreButtonRef} type="button" className={moreOpen || ["ricordi", "info", "frasario"].includes(tab) ? "active" : ""} aria-expanded={moreOpen} aria-haspopup="true" aria-controls="travel-more-menu" onClick={() => setMoreOpen((value) => !value)}><CircleUserRound/><span>Altro</span></button></nav>
    {moreOpen && <div ref={moreMenuRef} id="travel-more-menu" className="moreMenu" role="region" aria-label="Altre sezioni">
      <div className="moreMenuHead"><strong>Altro</strong><small>Informazioni e frasi di viaggio</small></div>
      <button type="button" aria-current={tab === "info" ? "page" : undefined} onClick={() => { setTab("info"); setMoreOpen(false); }}><Info/><span><strong>Informazioni utili</strong><small>Contatti, valuta e consigli</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "frasario" ? "page" : undefined} onClick={() => { setTab("frasario"); setMoreOpen(false); }}><Languages/><span><strong>Frasi</strong><small>Parole utili durante il viaggio</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "chat" ? "page" : undefined} onClick={() => { setTab("chat"); setMoreOpen(false); }}><MessageCircle/><span><strong>Chat con l’agenzia</strong><small>Domande e aggiornamenti operativi</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "sos" ? "page" : undefined} onClick={() => { setTab("sos"); setMoreOpen(false); }}><ShieldAlert/><span><strong>SOS e assistenza</strong><small>Contatti e posizione volontaria</small></span><ChevronRight/></button>
      <button type="button" aria-pressed={largeText} onClick={()=>togglePreference("text")}><Accessibility/><span><strong>Testo grande</strong><small>{largeText?"Attivo":"Aumenta la leggibilità"}</small></span><ChevronRight/></button>
      <button type="button" aria-pressed={simpleMode} onClick={()=>togglePreference("simple")}><Accessibility/><span><strong>Modalità semplificata</strong><small>{simpleMode?"Attiva":"Riduce gli elementi secondari"}</small></span><ChevronRight/></button>
    </div>}
    <div id="travel-main-content" className="travelMainContent" ref={contentRef} tabIndex={-1}>
    <div className="srStatus" role="status" aria-live="polite" aria-atomic="true">{saving ? "Salvataggio in corso" : ""}</div>
    {error && <p className="dataError" role="alert">{error}</p>}
    {experience.changeNotices.some(notice=>!notice.readAt)&&<section className="travelerChangeNotices" aria-labelledby="change-notices-title"><header><div><small>AGGIORNAMENTI DEL VIAGGIO</small><h2 id="change-notices-title">Cosa è cambiato</h2></div><span>{experience.changeNotices.filter(notice=>!notice.readAt).length} da leggere</span></header>{experience.changeNotices.filter(notice=>!notice.readAt).map(notice=><article key={notice.id} className={`severity-${notice.severity}`}><div><small>{new Intl.DateTimeFormat("it-IT",{dateStyle:"short",timeStyle:"short"}).format(new Date(notice.publishedAt))}</small><strong>{notice.title}</strong><p>{notice.summary}</p></div><button type="button" disabled={saving===`notice-${notice.id}`} onClick={()=>void acknowledgeNotice(notice.id)}>{saving===`notice-${notice.id}`?<LoaderCircle className="spin"/>:<Check/>} Ho letto</button></article>)}</section>}

    {tab === "mappa" && <section className="overviewPage"><div className="overviewHead"><div><span>MAPPA OPERATIVA</span><h2>Giorno {day.number} · {day.city}</h2><p>Visite e pernottamenti disponibili per questa giornata.</p></div><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(day.city || experience.journey.destinationCountry)}`} target="_blank" rel="noreferrer">Apri indicazioni <ExternalLink/></a></div>{operationalPoints.length > 0 ? <><div className="overviewMap"><TripOverviewMap days={operationalPoints} onSelect={()=>undefined}/></div><div className="overviewDayList">{operationalPoints.map((entry) => <a key={`${entry.lat}-${entry.lon}-${entry.title}`} href={`https://www.google.com/maps/dir/?api=1&destination=${entry.lat},${entry.lon}`} target="_blank" rel="noreferrer"><span style={{ background: entry.color }}>{entry.n}</span><span><small>{entry.city}</small><strong>{entry.title}</strong></span><ExternalLink/></a>)}</div><p className="mapAttribution">Le mappe già visualizzate restano disponibili offline per un periodo limitato.</p></> : <div className="empty"><Map/><h3>Luoghi in preparazione</h3><p>Per questa giornata non sono ancora disponibili coordinate operative.</p></div>}</section>}

    {tab === "programma" && <div className="dashboard">
      <aside className="timeline"><div className="sectionTitle"><div><span>ITINERARIO</span><h2>Giorno per giorno</h2></div><span>{active + 1} / {experience.days.length}</span></div><div className="dayList">{experience.days.map((entry, index) => { const date = dateParts(entry.date); const Transport = dayTransport(entry).Icon; return <button key={entry.id} className={`dayRow ${active === index ? "selected" : ""}`} onClick={() => selectDay(index)}><span className="dayDate"><b>{date.day}</b>{date.month}</span><span className="line"><i style={{ background: colors[index % colors.length] }}/></span><span className="dayInfo"><small>{entry.label || `GIORNO ${entry.number}`}</small><strong>{entry.city}</strong><em><Transport/>{entry.title}</em></span><ChevronRight/></button>; })}</div></aside>
      <section className="detail">
        <div className="detailHead"><div><span className="tag" style={{ color: colors[active % colors.length] }}>{day.label || `GIORNO ${day.number}`} · {currentDate.full}</span><h2>{day.title}</h2><p><MapPin/><span className="cityLinks">{day.cities.length ? day.cities.map((city, index) => <Fragment key={city.id}>{index > 0 && <ArrowRight/>}<a href={city.googleUrl} target="_blank" rel="noreferrer">{city.name}<ExternalLink/></a></Fragment>) : day.city}</span></p></div><div className="pager"><button type="button" aria-label="Giornata precedente" disabled={active === 0} onClick={() => selectDay(active - 1)}><ArrowLeft/></button><button type="button" aria-label="Giornata successiva" disabled={active === experience.days.length - 1} onClick={() => selectDay(active + 1)}><ArrowRight/></button></div></div>
        <section className="dayContext dayContextOpen" aria-labelledby={`day-details-${day.id}`}>
          <h3 id={`day-details-${day.id}`}>Dettagli della giornata</h3>
          {day.description && <p className="description">{day.description}</p>}
        </section>
        <section className="dayProgramme"><div className="dayProgrammeList">
          {day.items.map((item, index) => {
            const presentation = itemPresentation(item.type); const ItemIcon = presentation.Icon;
            const site = relatedSite(day, item);
            const showTypeIcon = item.type !== "visit" && item.type !== "hotel";
            const hasVisibleTime = ["transport", "flight", "train"].includes(item.type)
              && Boolean(item.startsAt || item.endsAt);
            const ratingBusy = saving === `rating-itinerary_item-${item.id}`;
            return <article className={`programmeStep type-${item.type} ${showTypeIcon ? "" : "withoutTypeIcon"}`} key={item.id}>
              <span className="programmeStepNumber">{String(index + 1).padStart(2, "0")}</span><span className="programmeStepLine"/>{showTypeIcon && <span className="programmeStepIcon" aria-hidden="true"><ItemIcon/></span>}
              <div className="programmeStepBody"><div className="programmeStepMeta"><small>{presentation.label}</small>{hasVisibleTime && <time><Clock3/>{item.startsAt || item.endsAt}{item.startsAt && item.endsAt ? ` – ${item.endsAt}` : ""}</time>}</div>
                <h4>{site ? <a href={site.googleUrl} target="_blank" rel="noreferrer">{item.title}<ExternalLink/></a> : item.title}</h4>
                {item.description && <div className={item.type === "transport" ? "programmeOperationalNote" : "programmeDescriptionNote"}>{item.type === "transport" && <strong>Note operative</strong>}<p>{item.description}</p></div>}
                {item.tickets.length > 0 && <div className="travelerTickets">{item.tickets.map((ticket) => <a href={ticket.downloadUrl} key={ticket.id}><FileText/><span><strong>Biglietto</strong><small>{ticket.title}</small></span><Download/></a>)}</div>}
                <RatingStars value={item.rating} busy={ratingBusy} label={`Valutazione di ${item.title}`} onRate={(rating) => void saveRating(day.id, "itinerary_item", item.id, rating)}/>
              </div>
            </article>;
          })}
          {day.hotels.map((hotel, hotelIndex) => { const ratingBusy = saving === `rating-hotel-${hotel.id}`; return <article className="programmeStep type-hotel" key={`hotel-${hotel.id}`}>
            <span className="programmeStepNumber">{String(day.items.length + hotelIndex + 1).padStart(2, "0")}</span><span className="programmeStepLine"/>
            <div className="programmeStepBody"><div className="programmeStepMeta"><small>Pernottamento</small></div><h4><a href={hotel.googleUrl} target="_blank" rel="noreferrer">{hotel.name}<ExternalLink/></a></h4><p>{hotel.city}</p><RatingStars value={hotel.rating} busy={ratingBusy} label={`Valutazione di ${hotel.name}`} onRate={(rating) => void saveRating(day.id, "hotel", hotel.id, rating)}/></div>
          </article>; })}
          {day.items.length === 0 && day.hotels.length === 0 && <div className="programmeEmpty">Programma dettagliato ancora da completare.</div>}
        </div></section>
        <div className="journal"><div><MessageCircle/><strong>Nota del giorno</strong></div><textarea placeholder="Scrivi qui un ricordo, un consiglio, una curiosità…" value={dayNote?.text || ""} onChange={(event) => setExperience((current) => ({ ...current, notes: current.notes.some((entry) => entry.dayId === day.id) ? current.notes.map((entry) => entry.dayId === day.id ? { ...entry, text: event.target.value, updatedBy: userName } : entry) : [...current.notes, { id: "new", dayId: day.id, dayNumber: day.number, text: event.target.value, updatedBy: userName, updatedAt: "" }] }))} onBlur={() => void saveNote()}/>{saving === `note-${day.id}` ? <small className="auditBy">Salvataggio…</small> : dayNote?.text && <small className="auditBy">Ultima modifica: {dayNote.updatedBy}</small>}</div>
      </section>
    </div>}

    {tab === "ricordi" && <section className="collection memoriesPage">
      <header className="memoriesHead"><div><Camera/><span><small>RICORDI DEL VIAGGIO</small><h2>La nostra galleria</h2><p>Le foto condivise dal gruppo, ordinate per giornata.</p></span></div>{experience.photos.length > 0 && <strong>{experience.photos.length}<small>{experience.photos.length === 1 ? "foto" : "foto"}</small></strong>}</header>
      <div className="memoryAlbumActions"><a href={`/api/traveler/travel-album?partenza=${encodeURIComponent(experience.journey.departureId)}`} download><Download/> Scarica diario PDF</a><button type="button" onClick={()=>void shareAlbum()}><Share2/> Condividi diario</button></div>
      {experience.photos.length === 0 ? <div className="empty memoriesEmpty"><Camera/><h3>La galleria aspetta il primo ricordo</h3><p>Le foto caricate nelle sfide e nei contest appariranno qui, disponibili per tutto il gruppo.</p><button type="button" onClick={() => setTab("sfide")}>Apri le sfide</button></div> : <>
        {memoryDays.length > 1 && <div className="memoryFilters" role="group" aria-label="Filtra le foto per giornata"><button type="button" className={memoryDayFilter === "all" ? "active" : ""} aria-pressed={memoryDayFilter === "all"} onClick={() => setMemoryDayFilter("all")}>Tutte <span>{experience.photos.length}</span></button>{memoryDays.map((dayNumber) => <button type="button" key={dayNumber} className={memoryDayFilter === dayNumber ? "active" : ""} aria-pressed={memoryDayFilter === dayNumber} onClick={() => setMemoryDayFilter(dayNumber)}>Giorno {dayNumber} <span>{photosByDay[dayNumber].length}</span></button>)}</div>}
        <p className="memoryResult" role="status">{visiblePhotos.length === 1 ? "1 foto visualizzata" : `${visiblePhotos.length} foto visualizzate`}</p>
        <div className="photoGrid">{visiblePhotos.map((photo) => <figure key={photo.id}><img src={photo.contentUrl} alt={`Ricordo del giorno ${photo.dayNumber}: ${photo.originalName}`} width={800} height={600} loading="lazy" decoding="async"/><div className="photoActions"><a href={photo.downloadUrl} download aria-label={`Scarica ${photo.originalName}`} title="Scarica foto"><Download/></a></div><figcaption><strong>Giorno {photo.dayNumber}</strong><span>{photo.addedBy}</span></figcaption></figure>)}</div>
      </>}
    </section>}

    {tab === "documenti" && <section className="collection documentsPage">
      <header className="documentsHead"><div><Wallet/><span><small>DOCUMENT WALLET</small><h2>Voucher, biglietti e documenti</h2><p>Archivio privato del tuo gruppo, consultabile anche offline dopo il download.</p></span></div><div className="offlinePackageAction"><button type="button" disabled={offlinePackage==="downloading"} onClick={()=>void prepareOffline()}><Download/>{offlinePackage==="downloading"?`Download ${offlineProgress.done}/${offlineProgress.total}`:offlinePackage==="ready"?"Disponibile offline":"Scarica il viaggio"}</button><small>{travelDocuments.length} {travelDocuments.length === 1 ? "documento" : "documenti"}</small></div></header>
      {travelDocuments.length === 0 ? <div className="empty documentsEmpty"><FileText/><h3>Nessun documento disponibile</h3><p>L’agenzia non ha ancora allegato documenti per il tuo gruppo. Li troverai qui appena saranno pubblicati.</p><button type="button" onClick={() => setTab("programma")}>Torna al programma</button></div> : <div className="documentList">{travelDocuments.map((ticket) => {
        const DocumentIcon = itemPresentation(ticket.itemType).Icon;
        return <article key={ticket.id}><span className="documentIcon"><DocumentIcon/></span><span className="documentCopy"><small>GIORNO {ticket.dayNumber} · {dateParts(ticket.dayDate).full}</small><strong>{ticket.title}</strong><p>{ticket.itemTitle} · {ticket.dayTitle}</p></span><a href={ticket.downloadUrl} download aria-label={`Scarica ${ticket.title}`} onClick={()=>trackAnalytics("document_download",{documentId:ticket.id,dayNumber:ticket.dayNumber})}><Download/><span>Scarica</span></a></article>;
      })}</div>}
    </section>}

    {tab === "spese" && <section className="collection expensesPage"><div className="expenseHero"><span>SPESE, PRELIEVI E CAMBI</span><h2>Totali per valuta</h2><div className="expenseCurrencyTotals"><div><small>EURO</small><strong>€ {totals.EUR.toFixed(2)}</strong></div><div><small>VALUTA LOCALE</small><strong>{localFormatter.format(totals.local)} {localCurrency}</strong></div><div className="grandTotal"><small>TOTALE SPESO IN EURO</small><strong>{totalSpentEuro == null ? "Calcolo…" : `€ ${totalSpentEuro.toFixed(2)}`}</strong></div></div><p>Gruppo: {experience.journey.partyName}{appliedEurRate ? ` · Conversione: 1 € = ${localFormatter.format(appliedEurRate)} ${localCurrency}` : ""}</p></div><div className="financeActions"><button type="button" onClick={() => setExpenseDayId(null)}><ReceiptText/><span>Aggiungi spesa<small>Spesa del gruppo</small></span></button><button type="button" disabled={saving === "cash"} onClick={() => setCashDialogKind("withdrawal")}><Banknote/><span>Aggiungi prelievo<small>Giorno {day.number}</small></span></button><button type="button" disabled={saving === "cash"} onClick={() => setCashDialogKind("exchange")}><ArrowRightLeft/><span>Aggiungi cambio<small>Giorno {day.number}</small></span></button></div>{experience.expenses.length === 0 ? <div className="financeEmpty"><ReceiptText/><div><h3>Nessuna spesa registrata</h3><p>Aggiungi la prima spesa per iniziare il riepilogo del gruppo.</p></div><button type="button" onClick={() => setExpenseDayId(null)}>Aggiungi spesa</button></div> : <div className="expenseList">{experience.expenses.map((expense) => <div key={expense.id}><span className="receipt"><ReceiptText/></span><span><strong>{expense.label}</strong><small>Pagato da {expense.paidBy}{expense.dayNumber ? ` · Giorno ${expense.dayNumber}` : ""}</small></span><b>{expense.currency === "EUR" ? `€ ${expense.amount.toFixed(2)}` : `${som.format(expense.amount)} ${expense.currency}`}</b><button className="financeDelete" type="button" disabled={saving === `delete-expense-${expense.id}`} onClick={() => void deleteExpense(expense.id)} aria-label={`Elimina la spesa ${expense.label}`} title="Elimina spesa">{saving === `delete-expense-${expense.id}` ? <LoaderCircle className="spin"/> : <Trash2/>}</button></div>)}</div>}<div className="cashSection"><div className="sectionTitle"><div><span>GESTIONE CONTANTI</span><h2>Prelievi e cambi</h2></div></div>{experience.cashMovements.length === 0 ? <p className="cashEmpty">Nessun prelievo o cambio registrato.</p> : <div className="cashMovementList">{experience.cashMovements.map((movement) => <div key={movement.id}><span className={`cashIcon ${movement.kind}`}><Banknote/></span><span><strong>{movement.kind === "withdrawal" ? "Prelievo ATM" : "Cambio valuta"}</strong><small>Giorno {movement.dayNumber} · Inserito da {movement.addedBy}</small><em className="appliedExchangeRate">{exchangeRateLabel(movement.euroAmount, movement.localAmount, movement.localCurrency)}</em></span><b>{movement.euroAmount != null && <small>€ {movement.euroAmount.toFixed(2)}</small>}{som.format(movement.localAmount)} {movement.localCurrency}</b><button className="financeDelete" type="button" disabled={saving === `delete-cash-${movement.id}`} onClick={() => void deleteCashMovement(movement.id, movement.kind === "withdrawal" ? "withdrawal" : "exchange")} aria-label={`Elimina ${movement.kind === "withdrawal" ? "il prelievo" : "il cambio"}`} title={movement.kind === "withdrawal" ? "Elimina prelievo" : "Elimina cambio"}>{saving === `delete-cash-${movement.id}` ? <LoaderCircle className="spin"/> : <Trash2/>}</button></div>)}</div>}</div></section>}

    {tab === "info" && <section className="usefulPage"><header className="usefulHero"><span>PRONTI A PARTIRE</span><h2>Informazioni utili</h2><p>Contatti e consigli pratici sempre a portata di mano. Verifica i requisiti sensibili prima della partenza.</p></header><div className="worldClockBar"><article><small>ITALIA</small><strong>{formatClock("Europe/Rome", now)}</strong><span>Ora italiana</span></article><div><ArrowRightLeft/><span>1 € = {appliedEurRate ? localFormatter.format(appliedEurRate) : "…"} {localCurrency}</span></div><article><small>{experience.journey.destinationCountry.toUpperCase()}</small><strong>{formatClock(localTimeZone, now)}</strong><span>Ora locale</span></article></div><section className="infoSection"><div className="infoSectionHead"><Info/><div><small>{experience.journey.destinationCountry}</small><h3>Tutto ciò che serve sapere</h3></div></div><div className="cultureGrid">{displayedUsefulInfo.map((item, index) => <article key={`${item.title}-${index}`}><Info/><h4>{item.title}</h4><p>{item.body}</p>{item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}<footer className="usefulGovernance"><span className={`review-${item.reviewStatus}`}>{item.reviewStatus==="approved"?"Verificato":"Da verificare"}</span>{item.verifiedAt&&<time>Verificato il {new Intl.DateTimeFormat("it-IT").format(new Date(item.verifiedAt))}</time>}{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte: {item.sourceName||"sito ufficiale"}<ExternalLink/></a>}{item.disclaimer&&<small>{item.disclaimer}</small>}</footer></article>)}</div></section></section>}
    {tab === "frasario" && <section className="phrasebookPage"><header className="phrasebookHero"><span><Languages/></span><div><small>PAROLE UTILI</small><h2>Frasario da viaggio</h2><p>Le parole giuste per salutare, ordinare, spostarsi e chiedere aiuto.</p></div></header><div className="languageNote">Pronuncia semplificata e traduzione italiana, preparate per <strong>{experience.journey.destinationCountry}</strong>.</div><div className="phraseList">{experience.phrases.map((phrase, index) => <article key={`${phrase.term}-${index}`}><span className="phraseCategory">{phrase.category}</span><h3>{phrase.translation}</h3><div className="phraseTranslations"><div><small>{phrase.language}</small><strong>{phrase.term}</strong><em>{phrase.pronunciation}</em></div></div></article>)}</div></section>}
    {tab === "sos" && <section className="collection sosPage"><header><ShieldAlert/><div><small>ASSISTENZA IN VIAGGIO</small><h2>SOS e contatti utili</h2><p>Consulta le istruzioni e contatta subito i servizi competenti. SMF Travel non condivide né conserva la tua posizione.</p></div></header><div className="sosActions"><a href={`tel:${displayedUsefulInfo.find((section)=>section.title==="Numeri di emergenza")?.phone || "112"}`}><Phone/><span><strong>Chiama emergenze</strong><small>{displayedUsefulInfo.find((section)=>section.title==="Numeri di emergenza")?.phone || "112"}</small></span></a><button type="button" onClick={()=>setTab("chat")}><MessageCircle/><span><strong>Contatta l’agenzia</strong><small>Apri la chat operativa del gruppo</small></span></button></div><div className="sosGuidance"><h3>Prima di agire</h3><ol><li>Se sei in pericolo immediato, chiama il numero di emergenza locale.</li><li>Comunica nome, luogo e cosa è successo.</li><li>Avvisa il capogruppo o l’agenzia appena possibile.</li></ol></div></section>}
    {tab === "spese" && experience.expenses.length>0 && <section className="collection expenseBalances" aria-labelledby="expense-balances-title"><div><small>PAREGGIO DEL GRUPPO</small><h2 id="expense-balances-title">Saldo per viaggiatore</h2><p>Valori positivi: deve ricevere. Valori negativi: deve versare.</p></div><div>{expenseBalances.map((traveler)=><article key={traveler.id}><span>{initials(traveler.name)}</span><strong>{traveler.name}</strong><b className={traveler.balance>=0?"credit":"debit"}>{traveler.balance>=0?"+":"−"} € {Math.abs(traveler.balance).toFixed(2)}</b></article>)}</div></section>}
    {tab === "chat" && <OperationalChat departureId={experience.journey.departureId} partyId={experience.journey.partyId}/>}
    {tab === "sfide" && <PlatformTripChallenges experience={experience} userName={userName} isAdmin={isAgencyAdmin} onResultsChange={(challengeResults) => setExperience((current) => ({ ...current, challengeResults }))}/>}
    </div>
    <ExpenseDialog open={expenseDayId !== undefined} dayLabel={expenseDayId ? currentDate.full : undefined} localCurrency={localCurrency} travelers={experience.journey.travelers.map(({id,name})=>({id,name}))} saving={saving === "expense"} onClose={() => setExpenseDayId(undefined)} onSave={saveExpense}/>
    <CashMovementDialog kind={cashDialogKind} dayLabel={String(day.number)} localCurrency={localCurrency} saving={saving === "cash"} onClose={() => setCashDialogKind(null)} onSave={(input) => cashDialogKind ? addCash(cashDialogKind, input) : Promise.resolve(false)}/>
  </main>;
}
