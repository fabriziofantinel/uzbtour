"use client";

import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Banknote, BedDouble, Building2, Bus,
  CalendarDays, Camera, ChevronRight, CircleUserRound, Clock3,
  Check, Download, ExternalLink, FileText, Info, Languages, LoaderCircle, LocateFixed, LogOut, Map,
  MapPin, MessageCircle, Navigation, Plane, ReceiptText,
  Sparkles, Star, TrainFront, Trash2, Utensils, Wallet, Wifi, WifiOff,
} from "lucide-react";
import ExpenseDialog from "@/components/expense-dialog";
import CashMovementDialog from "@/components/cash-movement-dialog";
import type { TripMapDay } from "@/components/trip-overview-map";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";

const TripOverviewMap = dynamic(() => import("@/components/trip-overview-map"), {
  ssr: false,
  loading: () => <div className="componentLoading" role="status">Caricamento della mappa…</div>,
});
const PlatformTripChallenges = dynamic(() => import("@/components/platform-trip-challenges"), {
  loading: () => <div className="componentLoading" role="status">Caricamento delle sfide…</div>,
});
const Phrasebook = dynamic(() => import("@/components/phrasebook"), {
  loading: () => <div className="componentLoading" role="status">Caricamento del frasario…</div>,
});
const UsefulInfo = dynamic(() => import("@/components/useful-info"), {
  loading: () => <div className="componentLoading" role="status">Caricamento delle informazioni…</div>,
});

type Tab = "oggi" | "mappa" | "programma" | "ricordi" | "documenti" | "spese" | "info" | "frasario" | "sfide";
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

function hexChannels(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function relativeLuminance(hex: string) {
  const channels = hexChannels(hex).map((value) => value / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + .05) / (dark + .05);
}

function accessibleBrandColor(hex: string) {
  let channels = hexChannels(hex);
  let candidate = hex;
  while (contrastRatio(candidate, "#FAF7F0") < 4.5) {
    channels = channels.map((value) => Math.max(0, Math.round(value * .82)));
    candidate = `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return candidate;
}

function brandContrastColor(hex: string) {
  return contrastRatio(hex, "#142B35") >= contrastRatio(hex, "#FFFFFF") ? "#142B35" : "#FFFFFF";
}

function distanceMetres(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const [locationState, setLocationState] = useState<"idle" | "requesting" | "suggested" | "unavailable">("idle");
  const [locationMessage, setLocationMessage] = useState("La posizione viene controllata solo quando lo chiedi.");
  const [suggestedItemId, setSuggestedItemId] = useState<string | null>(null);
  const [currentItems, setCurrentItems] = useState<Record<string, string>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [memoryDayFilter, setMemoryDayFilter] = useState<number | "all">("all");
  const [isOnline, setIsOnline] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const firstTabRender = useRef(true);
  const day = experience.days[active] ?? experience.days[0];
  const currentItemId = day ? currentItems[day.id] ?? null : null;
  const currentItemIndex = day ? day.items.findIndex((item) => item.id === currentItemId) : -1;
  const suggestedItem = day?.items.find((item) => item.id === suggestedItemId) ?? null;
  const photosByDay = useMemo(() => experience.photos.reduce<Record<number, Experience["photos"]>>((all, photo) => {
    all[photo.dayNumber] = [...(all[photo.dayNumber] || []), photo]; return all;
  }, {}), [experience.photos]);
  const memoryDays = useMemo(() => Object.keys(photosByDay).map(Number).sort((left, right) => left - right), [photosByDay]);
  const visiblePhotos = useMemo(() => memoryDayFilter === "all"
    ? experience.photos
    : experience.photos.filter((photo) => photo.dayNumber === memoryDayFilter), [experience.photos, memoryDayFilter]);
  const travelDocuments = useMemo(() => experience.days.flatMap((entry) => entry.items.flatMap((item) => item.tickets.map((ticket) => ({
    ...ticket,
    dayNumber: entry.number,
    dayDate: entry.date,
    dayTitle: entry.title,
    itemTitle: item.title,
    itemType: item.type,
  })))), [experience.days]);
  const totals = useMemo(() => experience.expenses.reduce((sum, expense) => {
    if (expense.currency === "EUR" || expense.currency === "UZS") sum[expense.currency] += expense.amount;
    return sum;
  }, { EUR: 0, UZS: 0 }), [experience.expenses]);
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
      else if (expense.currency === "UZS" && appliedEurRate) total += expense.amount / appliedEurRate;
      else return null;
    }
    return total;
  }, [appliedEurRate, experience.expenses]);
  const dayTotals = useMemo(() => experience.expenses.reduce((sum, expense) => {
    if (expense.dayId === day?.id && (expense.currency === "EUR" || expense.currency === "UZS")) sum[expense.currency] += expense.amount;
    return sum;
  }, { EUR: 0, UZS: 0 }), [day?.id, experience.expenses]);
  const tripMapDays = useMemo<TripMapDay[]>(() => experience.days.flatMap((entry, index) => {
    const city = mapCityForDay(entry);
    return city ? [{ index, n: entry.number, date: dateParts(entry.date).full, city: city.name,
      title: entry.title, lat: city.latitude!, lon: city.longitude!, color: colors[index % colors.length] }] : [];
  }), [experience.days]);

  useEffect(() => {
    let activeRequest = true;
    fetch("/api/exchange-rate").then((response) => response.ok ? response.json() : null)
      .then((result: { rate?: number } | null) => {
        if (activeRequest && result?.rate && Number.isFinite(result.rate)) setOfficialEurRate(result.rate);
      }).catch(() => undefined);
    return () => { activeRequest = false; };
  }, []);

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
    setSuggestedItemId(null);
    setLocationState("idle");
    setLocationMessage("La posizione viene controllata solo quando lo chiedi.");
  }
  function openDay(index: number) { selectDay(index); setTab("programma"); }
  function openProgramme() {
    selectDay(currentDayIndex(experience.days, experience.journey.timezone));
    setTab("programma");
  }
  function requestNearbyVisit() {
    if (!day) return;
    const candidates = day.items.flatMap((item) => {
      if (item.type !== "visit") return [];
      const site = relatedSite(day, item);
      const latitude = item.latitude ?? site?.latitude ?? null;
      const longitude = item.longitude ?? site?.longitude ?? null;
      return latitude == null || longitude == null ? [] : [{ item, latitude, longitude }];
    });
    if (candidates.length === 0) {
      setLocationState("unavailable");
      setSuggestedItemId(null);
      setLocationMessage("Queste visite non hanno ancora coordinate precise. Puoi indicare manualmente la tappa attuale.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocationState("unavailable");
      setLocationMessage("La posizione non è disponibile su questo dispositivo. Seleziona manualmente la tappa.");
      return;
    }
    setLocationState("requesting");
    setLocationMessage("Cerco la visita più vicina…");
    navigator.geolocation.getCurrentPosition((position) => {
      const current = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const nearest = candidates.map((candidate) => ({ item: candidate.item, distance: distanceMetres(current, {
        latitude: candidate.latitude, longitude: candidate.longitude,
      }) })).sort((left, right) => left.distance - right.distance)[0];
      if (!nearest || nearest.distance > 350) {
        setLocationState("unavailable");
        setSuggestedItemId(null);
        setLocationMessage("Non risulti vicino a una visita prevista oggi. Puoi scegliere la tappa manualmente.");
        return;
      }
      setSuggestedItemId(nearest.item.id);
      setLocationState("suggested");
      setLocationMessage(`Sei a circa ${Math.max(10, Math.round(nearest.distance / 10) * 10)} m da ${nearest.item.title}.`);
    }, () => {
      setLocationState("unavailable");
      setLocationMessage("Posizione non autorizzata. Puoi continuare e scegliere la tappa manualmente.");
    }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 });
  }
  function confirmCurrentItem(itemId: string) {
    if (!day) return;
    setCurrentItems((current) => ({ ...current, [day.id]: itemId }));
    setSuggestedItemId(null);
    setLocationState("idle");
    setLocationMessage("Tappa attuale confermata. Puoi modificarla in qualsiasi momento.");
  }
  async function postJournal(body: Record<string, unknown>) {
    const response = await fetch("/api/traveler/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, ...body }) });
    const result = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
    return result;
  }
  async function saveRating(dayId: string, targetType: "itinerary_item" | "hotel", targetId: string, rating: number) {
    const busyKey = `rating-${targetType}-${targetId}`;
    setSaving(busyKey); setError("");
    try {
      const response = await fetch("/api/traveler/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId, targetType, targetId, rating, clientOperationId: crypto.randomUUID() }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Valutazione non salvata");
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
      const result = await postJournal({ action: "cash", dayId: day.id, kind, localAmount, euroAmount, feeEuro: null, clientOperationId: crypto.randomUUID() }) as { movement: { id: string; createdAt: string } };
      setExperience((current) => ({ ...current, cashMovements: [{ id: result.movement.id, dayId: day.id, dayNumber: day.number, kind, euroAmount, localAmount, localCurrency: "UZS", feeEuro: null, addedBy: userName, createdAt: result.movement.createdAt }, ...current.cashMovements] }));
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
  async function saveExpense(input: { label: string; amount: string; currency: "EUR" | "UZS" }) {
    const amount = numberValue(input.amount);
    if (!amount || amount <= 0) { setError("Inserisci un importo valido."); return false; }
    setSaving("expense"); setError("");
    try {
      const exchangeRateToBase = input.currency === "EUR" ? 1 : appliedEurRate ? 1 / appliedEurRate : null;
      const response = await fetch("/api/traveler/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departureId: experience.journey.departureId, partyId: experience.journey.partyId, dayId: expenseDayId, label: input.label, amount, currency: input.currency, exchangeRateToBase, clientOperationId: crypto.randomUUID() }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "Spesa non salvata");
      const expenseDay = experience.days.find((entry) => entry.id === expenseDayId);
      setExperience((current) => ({ ...current, expenses: [{ id: result.id!, dayId: expenseDayId || null, dayNumber: expenseDay?.number ?? null, label: input.label, amount, currency: input.currency, baseCurrency: "EUR", exchangeRateToBase, baseAmount: exchangeRateToBase == null ? null : Math.round(amount * exchangeRateToBase * 10_000) / 10_000, paidBy: userName, createdAt: new Date().toISOString() }, ...current.expenses] }));
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Spesa non salvata"); return false; }
    finally { setSaving(""); }
  }
  if (!day) return null;
  const currentDate = dateParts(day.date);
  const transport = dayTransport(day);
  const dayNote = experience.notes.find((entry) => entry.dayId === day.id);
  const isUzbekistan = experience.journey.destinationCountry.toLocaleLowerCase("it").includes("uzbek");
  const agencyColor = validBrandColor(experience.journey.agencyBranding.primaryColor);
  const agencyPrimary = accessibleBrandColor(agencyColor);
  const agencyLogo = experience.journey.agencyBranding.logoUrl;
  const brandStyle = {
    "--agency-source": agencyColor,
    "--agency-primary": agencyPrimary,
    "--agency-on-primary": brandContrastColor(agencyPrimary),
  } as CSSProperties;

  return <main className="travelExperience travelerRedesign" style={brandStyle} data-design-contract="b0beb44b" data-design-thesis="sentiero-delle-tappe">
    <a className="skipLink" href="#travel-main-content">Salta al contenuto del viaggio</a>
    <header className="topbar"><div className="brand">{agencyLogo ? <img className="agencyLogo" src={agencyLogo} alt={`Logo ${experience.journey.agencyName}`}/> : <span className="brandMark">{initials(experience.journey.agencyName)}</span>}<div><strong>{experience.journey.agencyName}</strong><small>POWERED BY SMF TRAVEL</small></div></div><div className="tripDates"><CalendarDays/><span>{dateParts(experience.journey.startsOn).full} — {dateParts(experience.journey.endsOn).full}</span><i>{experience.days.length} gg</i></div><div className="people"><span className={`connectionStatus ${isOnline ? "online" : "offline"}`} role="status" aria-live="polite">{isOnline ? <Wifi/> : <WifiOff/>}<b>{isOnline ? (saving ? "Salvataggio…" : "Online") : "Solo consultazione"}</b></span><span className="currentUser"><i>{initials(userName)}</i><b>{userName}</b></span><div className="avatars">{experience.journey.travelers.slice(0, 4).map((traveler) => <i key={traveler.name}>{initials(traveler.name)}</i>)}</div>{isAgencyAdmin && <a className="agencyButton" href="/agenzia"><Building2/><span>Agenzia</span></a>}<form action="/api/auth/logout" method="post"><button className="logoutButton"><LogOut/><span>Esci</span></button></form></div></header>
    {experience.availableJourneys.length > 1 && <nav className="journeyPicker">{experience.availableJourneys.map((journey) => <a className={journey.departureId === experience.journey.departureId ? "active" : ""} href={`/viaggio?partenza=${journey.departureId}`} key={journey.departureId}>{journey.title}<small>{dateParts(journey.startsOn).full}</small></a>)}</nav>}
    <section className="hero"><div className="heroTexture"/><div className="heroCopy"><p className="eyebrow">IL NOSTRO VIAGGIO</p><h1>{experience.journey.title}</h1><p>{experience.journey.destinationCountry} · {experience.journey.partyName}</p></div><div className="routeSummary"><div><strong>{experience.days.length}</strong><span>GIORNI</span></div><div><strong>{new Set(experience.days.flatMap((entry) => entry.cities.map((city) => city.name))).size}</strong><span>LOCALITÀ</span></div><div><strong>{experience.journey.travelers.length}</strong><span>VIAGGIATORI</span></div></div></section>
    <nav className="tabs" aria-label="Sezioni del viaggio"><button type="button" className={tab === "mappa" ? "active" : ""} aria-current={tab === "mappa" ? "page" : undefined} onClick={() => { setTab("mappa"); setMoreOpen(false); }}><Map/><span>Mappa</span></button><button type="button" className={tab === "programma" ? "active" : ""} aria-current={tab === "programma" ? "page" : undefined} onClick={() => { openProgramme(); setMoreOpen(false); }}><CalendarDays/><span>Programma</span></button><button type="button" aria-label="Spese, prelievi e cambi" className={tab === "spese" ? "active" : ""} aria-current={tab === "spese" ? "page" : undefined} onClick={() => { setTab("spese"); setMoreOpen(false); }}><Wallet/><span>Spese</span></button><button type="button" className={tab === "sfide" ? "active" : ""} aria-current={tab === "sfide" ? "page" : undefined} onClick={() => { setTab("sfide"); setMoreOpen(false); }}><Sparkles/><span>Sfide</span></button><button ref={moreButtonRef} type="button" className={moreOpen || ["ricordi", "documenti", "info", "frasario"].includes(tab) ? "active" : ""} aria-expanded={moreOpen} aria-haspopup="true" aria-controls="travel-more-menu" onClick={() => setMoreOpen((value) => !value)}><CircleUserRound/><span>Altro</span></button></nav>
    {moreOpen && <div ref={moreMenuRef} id="travel-more-menu" className="moreMenu" role="region" aria-label="Altre sezioni">
      <div className="moreMenuHead"><strong>Altro</strong><small>Ricordi, documenti e strumenti utili</small></div>
      <button type="button" aria-current={tab === "ricordi" ? "page" : undefined} onClick={() => { setTab("ricordi"); setMoreOpen(false); }}><Camera/><span><strong>Ricordi</strong><small>{experience.photos.length === 1 ? "1 foto del viaggio" : `${experience.photos.length} foto del viaggio`}</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "documenti" ? "page" : undefined} onClick={() => { setTab("documenti"); setMoreOpen(false); }}><FileText/><span><strong>Documenti</strong><small>{travelDocuments.length === 1 ? "1 biglietto disponibile" : `${travelDocuments.length} biglietti disponibili`}</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "info" ? "page" : undefined} onClick={() => { setTab("info"); setMoreOpen(false); }}><Info/><span><strong>Informazioni utili</strong><small>Contatti, valuta e consigli</small></span><ChevronRight/></button>
      <button type="button" aria-current={tab === "frasario" ? "page" : undefined} onClick={() => { setTab("frasario"); setMoreOpen(false); }}><Languages/><span><strong>Frasi</strong><small>Parole utili durante il viaggio</small></span><ChevronRight/></button>
      {experience.availableJourneys.length > 1 && <div className="moreJourneys"><small>I MIEI VIAGGI</small>{experience.availableJourneys.map((journey) => <a className={journey.departureId === experience.journey.departureId ? "active" : ""} href={`/viaggio?partenza=${journey.departureId}`} key={journey.departureId}><Map/><span><strong>{journey.title}</strong><small>{dateParts(journey.startsOn).full} — {dateParts(journey.endsOn).full}</small></span>{journey.departureId === experience.journey.departureId ? <Check/> : <ChevronRight/>}</a>)}</div>}
      {isAgencyAdmin && <a href="/agenzia"><Building2/><span><strong>Area agenzia</strong><small>Gestisci viaggi e viaggiatori</small></span><ChevronRight/></a>}
      <form action="/api/auth/logout" method="post"><button type="submit"><LogOut/><span><strong>Esci</strong><small>{userName}</small></span><ChevronRight/></button></form>
    </div>}
    <div id="travel-main-content" className="travelMainContent" ref={contentRef} tabIndex={-1}>
    <div className="srStatus" role="status" aria-live="polite" aria-atomic="true">{saving ? "Salvataggio in corso" : ""}</div>
    {error && <p className="dataError" role="alert">{error}</p>}

    {tab === "oggi" && <section className="todayPage"><div className="todayHero"><div><span>{day.label || `GIORNO ${day.number}`} · {currentDate.full}</span><h2>{day.title}</h2><p>{day.city}</p></div><div className="todayHeroDay"><small>OGGI</small><strong>{currentDate.day}</strong><span>{currentDate.month}</span></div></div><section className="nextAppointment"><span><Clock3/></span><div><small>PROSSIMO APPUNTAMENTO</small><h3>{day.items[0]?.title || "Giornata libera"}</h3><p>{day.items[0]?.startsAt || "Orario da confermare"} · {day.city}</p></div><button onClick={() => setTab("programma")}><ChevronRight/></button></section><div className="todayInfoGrid"><article><span><Navigation/></span><small>PROGRAMMA</small><strong>{day.items.length} attività</strong><p>{transport.label}</p></article><article><span><BedDouble/></span><small>HOTEL</small><strong>{day.hotels[0]?.name || "Da confermare"}</strong><p>{day.hotels[0]?.city || day.city}</p></article><article><span><Wallet/></span><small>SPESE DI TAPPA</small><strong>€ {dayTotals.EUR.toFixed(2)}</strong><p>{som.format(dayTotals.UZS)} UZS</p></article><article><span><Camera/></span><small>RICORDI</small><strong>{photosByDay[day.number]?.length || 0} foto</strong><p>caricate per questa giornata</p></article></div><div className="todayActions"><button onClick={() => setTab("programma")}><Navigation/><span>Apri programma<small>Tutti i dettagli</small></span><ChevronRight/></button><button onClick={() => setTab("ricordi")}><Camera/><span>Ricordi del giorno<small>Foto della famiglia</small></span><ChevronRight/></button><button onClick={() => setTab("sfide")}><Sparkles/><span>Sfide del giorno<small>Quiz, missioni e giochi</small></span><ChevronRight/></button></div><section className="todaySchedule"><div><Navigation/><span><small>PROGRAMMA RAPIDO</small><h3>La giornata in un colpo d’occhio</h3></span></div>{day.items.map((item, index) => <article key={item.id}><time>{item.startsAt || String(index + 1).padStart(2, "0")}</time><span/><strong>{item.title}</strong></article>)}<button onClick={() => setTab("programma")}><ReceiptText/> Apri tutti i dettagli</button></section></section>}

    {tab === "mappa" && <section className="overviewPage"><div className="overviewHead"><div><span>LA ROTTA DEL VIAGGIO</span><h2>{experience.days.length} giorni, una mappa</h2><p>Tocca un numero sulla mappa o una tappa qui sotto per aprire il programma.</p></div><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(experience.journey.destinationCountry)}`} target="_blank" rel="noreferrer">Apri la mappa completa <ExternalLink/></a></div>{tripMapDays.length > 0 ? <><div className="overviewMap"><TripOverviewMap days={tripMapDays} onSelect={openDay}/></div><div className="overviewDayList">{tripMapDays.map((entry) => <button key={entry.n} onClick={() => openDay(entry.index)}><span style={{ background: entry.color }}>{entry.n}</span><span><small>{entry.date}</small><strong>{entry.city}</strong></span><ChevronRight/></button>)}</div><p className="mapAttribution">Coordinate fornite da <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.</p></> : <div className="empty"><Map/><h3>Mappa in preparazione</h3><p>Stiamo recuperando le coordinate delle località. Ricarica la pagina tra pochi secondi.</p></div>}</section>}

    {tab === "programma" && <div className="dashboard">
      <aside className="timeline"><div className="sectionTitle"><div><span>ITINERARIO</span><h2>Giorno per giorno</h2></div><span>{active + 1} / {experience.days.length}</span></div><div className="dayList">{experience.days.map((entry, index) => { const date = dateParts(entry.date); const Transport = dayTransport(entry).Icon; return <button key={entry.id} className={`dayRow ${active === index ? "selected" : ""}`} onClick={() => selectDay(index)}><span className="dayDate"><b>{date.day}</b>{date.month}</span><span className="line"><i style={{ background: colors[index % colors.length] }}/></span><span className="dayInfo"><small>{entry.label || `GIORNO ${entry.number}`}</small><strong>{entry.city}</strong><em><Transport/>{entry.title}</em></span><ChevronRight/></button>; })}</div></aside>
      <section className="detail">
        <div className="detailHead"><div><span className="tag" style={{ color: colors[active % colors.length] }}>{day.label || `GIORNO ${day.number}`} · {currentDate.full}</span><h2>{day.title}</h2><p><MapPin/><span className="cityLinks">{day.cities.length ? day.cities.map((city, index) => <Fragment key={city.id}>{index > 0 && <ArrowRight/>}<a href={city.googleUrl} target="_blank" rel="noreferrer">{city.name}<ExternalLink/></a></Fragment>) : day.city}</span></p></div><div className="pager"><button type="button" aria-label="Giornata precedente" disabled={active === 0} onClick={() => selectDay(active - 1)}><ArrowLeft/></button><button type="button" aria-label="Giornata successiva" disabled={active === experience.days.length - 1} onClick={() => selectDay(active + 1)}><ArrowRight/></button></div></div>
        <section className={`proximityPanel state-${locationState}`} aria-live="polite"><div className="proximityIcon"><LocateFixed/></div><div className="proximityCopy"><small>{suggestedItem ? "VISITA SUGGERITA DALLA POSIZIONE" : currentItemId ? "TAPPA ATTUALE" : "DOVE SEI NEL PROGRAMMA?"}</small><strong>{suggestedItem?.title || day.items.find((item) => item.id === currentItemId)?.title || "Individua la visita più vicina"}</strong><p>{locationMessage}</p></div>{suggestedItem ? <div className="proximityActions"><button type="button" className="confirm" onClick={() => confirmCurrentItem(suggestedItem.id)}><Check/>Conferma</button><button type="button" onClick={() => { setSuggestedItemId(null); setLocationState("idle"); setLocationMessage("Suggerimento ignorato. Puoi scegliere la tappa dalla scaletta."); }}>Non ora</button></div> : <button type="button" className="locateButton" disabled={locationState === "requesting"} onClick={requestNearbyVisit}>{locationState === "requesting" ? <LoaderCircle className="spin"/> : <LocateFixed/>}{locationState === "requesting" ? "Ricerca…" : "Individua"}</button>}</section>
        <section className="dayProgramme"><header><span>SCALLETTA DELLA GIORNATA</span><h3>Le attività nell’ordine previsto</h3><p>Gli orari compaiono solo per trasporti e prenotazioni che li prevedono.</p></header><div className="dayProgrammeList">
          {day.items.map((item, index) => {
            const presentation = itemPresentation(item.type); const ItemIcon = presentation.Icon;
            const site = relatedSite(day, item);
            const hasVisibleTime = ["transport", "flight", "train"].includes(item.type)
              && Boolean(item.startsAt || item.endsAt);
            const ratingBusy = saving === `rating-itinerary_item-${item.id}`;
            const progressClass = item.id === currentItemId ? "is-current" : currentItemIndex > index ? "is-complete" : item.id === suggestedItemId ? "is-suggested" : "";
            return <article className={`programmeStep type-${item.type} ${progressClass}`} key={item.id}>
              <span className="programmeStepNumber">{String(index + 1).padStart(2, "0")}</span><span className="programmeStepLine"/><span className="programmeStepIcon" aria-hidden="true"><ItemIcon/></span>
              <div className="programmeStepBody"><div className="programmeStepMeta"><small>{presentation.label}</small>{hasVisibleTime && <time><Clock3/>{item.startsAt || item.endsAt}{item.startsAt && item.endsAt ? ` – ${item.endsAt}` : ""}</time>}</div>
                <h4>{site ? <a href={site.googleUrl} target="_blank" rel="noreferrer">{item.title}<ExternalLink/></a> : item.title}</h4>
                {item.description && <div className={item.type === "transport" ? "programmeOperationalNote" : "programmeDescriptionNote"}>{item.type === "transport" && <strong>Note operative</strong>}<p>{item.description}</p></div>}
                {item.tickets.length > 0 && <div className="travelerTickets">{item.tickets.map((ticket) => <a href={ticket.downloadUrl} key={ticket.id}><FileText/><span><strong>Biglietto</strong><small>{ticket.title}</small></span><Download/></a>)}</div>}
                <button type="button" className="setCurrentStep" aria-pressed={item.id === currentItemId} onClick={() => confirmCurrentItem(item.id)}>{item.id === currentItemId ? <><Check/>Tappa attuale</> : "Sono qui"}</button>
                <RatingStars value={item.rating} busy={ratingBusy} label={`Valutazione di ${item.title}`} onRate={(rating) => void saveRating(day.id, "itinerary_item", item.id, rating)}/>
              </div>
            </article>;
          })}
          {day.hotels.map((hotel, hotelIndex) => { const ratingBusy = saving === `rating-hotel-${hotel.id}`; return <article className="programmeStep type-hotel" key={`hotel-${hotel.id}`}>
            <span className="programmeStepNumber">{String(day.items.length + hotelIndex + 1).padStart(2, "0")}</span><span className="programmeStepLine"/><span className="programmeStepIcon" aria-hidden="true"><BedDouble/></span>
            <div className="programmeStepBody"><div className="programmeStepMeta"><small>Pernottamento</small></div><h4><a href={hotel.googleUrl} target="_blank" rel="noreferrer">{hotel.name}<ExternalLink/></a></h4><p>{hotel.city}</p><RatingStars value={hotel.rating} busy={ratingBusy} label={`Valutazione di ${hotel.name}`} onRate={(rating) => void saveRating(day.id, "hotel", hotel.id, rating)}/></div>
          </article>; })}
          {day.items.length === 0 && day.hotels.length === 0 && <div className="programmeEmpty">Programma dettagliato ancora da completare.</div>}
        </div></section>
        {(day.description || day.hotels.length > 0) && <details className="dayContext"><summary>Dettagli della giornata</summary>{day.description && <p className="description">{day.description}</p>}<div className="stayInfo"><span><CircleUserRound/>{transport.label}</span><span><BedDouble/><strong>{day.hotels.map((hotel) => hotel.name).join(" · ") || "Pernottamento da confermare"}</strong></span></div></details>}
        <div className="journal"><div><MessageCircle/><strong>Nota del giorno</strong></div><textarea placeholder="Scrivi qui un ricordo, un consiglio, una curiosità…" value={dayNote?.text || ""} onChange={(event) => setExperience((current) => ({ ...current, notes: current.notes.some((entry) => entry.dayId === day.id) ? current.notes.map((entry) => entry.dayId === day.id ? { ...entry, text: event.target.value, updatedBy: userName } : entry) : [...current.notes, { id: "new", dayId: day.id, dayNumber: day.number, text: event.target.value, updatedBy: userName, updatedAt: "" }] }))} onBlur={() => void saveNote()}/>{saving === `note-${day.id}` ? <small className="auditBy">Salvataggio…</small> : dayNote?.text && <small className="auditBy">Ultima modifica: {dayNote.updatedBy}</small>}</div>
      </section>
    </div>}

    {tab === "ricordi" && <section className="collection memoriesPage">
      <header className="memoriesHead"><div><Camera/><span><small>RICORDI DEL VIAGGIO</small><h2>La nostra galleria</h2><p>Le foto condivise dalla famiglia, ordinate per giornata.</p></span></div>{experience.photos.length > 0 && <strong>{experience.photos.length}<small>{experience.photos.length === 1 ? "foto" : "foto"}</small></strong>}</header>
      {experience.photos.length === 0 ? <div className="empty memoriesEmpty"><Camera/><h3>La galleria aspetta il primo ricordo</h3><p>Le foto caricate nelle sfide e nei contest appariranno qui, disponibili per tutta la famiglia.</p><button type="button" onClick={() => setTab("sfide")}>Apri le sfide</button></div> : <>
        {memoryDays.length > 1 && <div className="memoryFilters" role="group" aria-label="Filtra le foto per giornata"><button type="button" className={memoryDayFilter === "all" ? "active" : ""} aria-pressed={memoryDayFilter === "all"} onClick={() => setMemoryDayFilter("all")}>Tutte <span>{experience.photos.length}</span></button>{memoryDays.map((dayNumber) => <button type="button" key={dayNumber} className={memoryDayFilter === dayNumber ? "active" : ""} aria-pressed={memoryDayFilter === dayNumber} onClick={() => setMemoryDayFilter(dayNumber)}>Giorno {dayNumber} <span>{photosByDay[dayNumber].length}</span></button>)}</div>}
        <p className="memoryResult" role="status">{visiblePhotos.length === 1 ? "1 foto visualizzata" : `${visiblePhotos.length} foto visualizzate`}</p>
        <div className="photoGrid">{visiblePhotos.map((photo) => <figure key={photo.id}><img src={photo.contentUrl} alt={`Ricordo del giorno ${photo.dayNumber}: ${photo.originalName}`} width={800} height={600} loading="lazy" decoding="async"/><div className="photoActions"><a href={photo.downloadUrl} download aria-label={`Scarica ${photo.originalName}`} title="Scarica foto"><Download/></a></div><figcaption><strong>Giorno {photo.dayNumber}</strong><span>{photo.addedBy}</span></figcaption></figure>)}</div>
      </>}
    </section>}

    {tab === "documenti" && <section className="collection documentsPage">
      <header className="documentsHead"><div><FileText/><span><small>DOCUMENTI DI VIAGGIO</small><h2>Biglietti sempre a portata di mano</h2><p>I documenti allegati dall’agenzia ai trasferimenti del programma.</p></span></div><strong>{travelDocuments.length}<small>{travelDocuments.length === 1 ? "documento" : "documenti"}</small></strong></header>
      {travelDocuments.length === 0 ? <div className="empty documentsEmpty"><FileText/><h3>Nessun documento disponibile</h3><p>L’agenzia non ha ancora allegato biglietti a voli, treni o trasferimenti. Li troverai qui appena saranno pubblicati.</p><button type="button" onClick={() => setTab("programma")}>Torna al programma</button></div> : <div className="documentList">{travelDocuments.map((ticket) => {
        const DocumentIcon = itemPresentation(ticket.itemType).Icon;
        return <article key={ticket.id}><span className="documentIcon"><DocumentIcon/></span><span className="documentCopy"><small>GIORNO {ticket.dayNumber} · {dateParts(ticket.dayDate).full}</small><strong>{ticket.title}</strong><p>{ticket.itemTitle} · {ticket.dayTitle}</p></span><a href={ticket.downloadUrl} download aria-label={`Scarica ${ticket.title}`}><Download/><span>Scarica</span></a></article>;
      })}</div>}
    </section>}

    {tab === "spese" && <section className="collection expensesPage"><div className="expenseHero"><span>SPESE, PRELIEVI E CAMBI</span><h2>Totali per valuta</h2><div className="expenseCurrencyTotals"><div><small>EURO</small><strong>€ {totals.EUR.toFixed(2)}</strong></div><div><small>VALUTA LOCALE</small><strong>{som.format(totals.UZS)} UZS</strong></div><div className="grandTotal"><small>TOTALE SPESO IN EURO</small><strong>{totalSpentEuro == null ? "Calcolo…" : `€ ${totalSpentEuro.toFixed(2)}`}</strong></div></div><p>Famiglia: {experience.journey.partyName}{appliedEurRate ? ` · Conversione: 1 € = ${som.format(appliedEurRate)} UZS` : ""}</p></div><div className="financeActions"><button type="button" onClick={() => setExpenseDayId(null)}><ReceiptText/><span>Aggiungi spesa<small>Spesa della famiglia</small></span></button><button type="button" disabled={saving === "cash"} onClick={() => setCashDialogKind("withdrawal")}><Banknote/><span>Aggiungi prelievo<small>Giorno {day.number}</small></span></button><button type="button" disabled={saving === "cash"} onClick={() => setCashDialogKind("exchange")}><ArrowRightLeft/><span>Aggiungi cambio<small>Giorno {day.number}</small></span></button></div>{experience.expenses.length === 0 ? <div className="financeEmpty"><ReceiptText/><div><h3>Nessuna spesa registrata</h3><p>Aggiungi la prima spesa per iniziare il riepilogo della famiglia.</p></div><button type="button" onClick={() => setExpenseDayId(null)}>Aggiungi spesa</button></div> : <div className="expenseList">{experience.expenses.map((expense) => <div key={expense.id}><span className="receipt"><ReceiptText/></span><span><strong>{expense.label}</strong><small>Pagato da {expense.paidBy}{expense.dayNumber ? ` · Giorno ${expense.dayNumber}` : ""}</small></span><b>{expense.currency === "EUR" ? `€ ${expense.amount.toFixed(2)}` : `${som.format(expense.amount)} ${expense.currency}`}</b><button className="financeDelete" type="button" disabled={saving === `delete-expense-${expense.id}`} onClick={() => void deleteExpense(expense.id)} aria-label={`Elimina la spesa ${expense.label}`} title="Elimina spesa">{saving === `delete-expense-${expense.id}` ? <LoaderCircle className="spin"/> : <Trash2/>}</button></div>)}</div>}<div className="cashSection"><div className="sectionTitle"><div><span>GESTIONE CONTANTI</span><h2>Prelievi e cambi</h2></div></div>{experience.cashMovements.length === 0 ? <p className="cashEmpty">Nessun prelievo o cambio registrato.</p> : <div className="cashMovementList">{experience.cashMovements.map((movement) => <div key={movement.id}><span className={`cashIcon ${movement.kind}`}><Banknote/></span><span><strong>{movement.kind === "withdrawal" ? "Prelievo ATM" : "Cambio valuta"}</strong><small>Giorno {movement.dayNumber} · Inserito da {movement.addedBy}</small><em className="appliedExchangeRate">{exchangeRateLabel(movement.euroAmount, movement.localAmount, movement.localCurrency)}</em></span><b>{movement.euroAmount != null && <small>€ {movement.euroAmount.toFixed(2)}</small>}{som.format(movement.localAmount)} {movement.localCurrency}</b><button className="financeDelete" type="button" disabled={saving === `delete-cash-${movement.id}`} onClick={() => void deleteCashMovement(movement.id, movement.kind === "withdrawal" ? "withdrawal" : "exchange")} aria-label={`Elimina ${movement.kind === "withdrawal" ? "il prelievo" : "il cambio"}`} title={movement.kind === "withdrawal" ? "Elimina prelievo" : "Elimina cambio"}>{saving === `delete-cash-${movement.id}` ? <LoaderCircle className="spin"/> : <Trash2/>}</button></div>)}</div>}</div></section>}

    {tab === "info" && (isUzbekistan ? <UsefulInfo/> : <section className="usefulPage"><header className="usefulHero"><span>PRONTI A PARTIRE</span><h2>Informazioni utili</h2><p>Contatti e consigli pratici sempre a portata di mano.</p></header><section className="infoSection"><div className="infoSectionHead"><Info/><div><small>{experience.journey.destinationCountry}</small><h3>Tutto ciò che serve sapere</h3></div></div><div className="cultureGrid">{experience.usefulInfo.map((item, index) => <article key={`${item.title}-${index}`}><Info/><h4>{item.title}</h4><p>{item.body}</p>{item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">Approfondisci <ExternalLink/></a>}</article>)}</div></section></section>)}
    {tab === "frasario" && (isUzbekistan ? <Phrasebook/> : <section className="phrasebookPage"><header className="phrasebookHero"><span><Languages/></span><div><small>PAROLE UTILI</small><h2>Frasario da viaggio</h2><p>Le parole giuste per salutare, ordinare, spostarsi e chiedere aiuto.</p></div></header><div className="languageNote">Pronuncia semplificata e traduzione italiana, preparate per <strong>{experience.journey.destinationCountry}</strong>.</div><div className="phraseList">{experience.phrases.map((phrase, index) => <article key={`${phrase.term}-${index}`}><span className="phraseCategory">{phrase.category}</span><h3>{phrase.translation}</h3><div className="phraseTranslations"><div><small>{phrase.language}</small><strong>{phrase.term}</strong><em>{phrase.pronunciation}</em></div></div></article>)}</div></section>)}
    {tab === "sfide" && <PlatformTripChallenges experience={experience} userName={userName} isAdmin={isAgencyAdmin} onResultsChange={(challengeResults) => setExperience((current) => ({ ...current, challengeResults }))}/>}
    </div>
    <ExpenseDialog open={expenseDayId !== undefined} dayLabel={expenseDayId ? currentDate.full : undefined} saving={saving === "expense"} onClose={() => setExpenseDayId(undefined)} onSave={saveExpense}/>
    <CashMovementDialog kind={cashDialogKind} dayLabel={String(day.number)} localCurrency="UZS" saving={saving === "cash"} onClose={() => setCashDialogKind(null)} onSave={(input) => cashDialogKind ? addCash(cashDialogKind, input) : Promise.resolve(false)}/>
  </main>;
}
