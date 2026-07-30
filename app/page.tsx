"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Banknote, Bus, CalendarDays, Camera, ChevronRight,
  CircleUserRound, Clock3, Download, ExternalLink, LoaderCircle, LogOut, Map, MapPin,
  MessageCircle, House, Info, Languages, Navigation, Plane, Plus, ReceiptText, ShieldCheck,
  Sparkles, Trash2, TrainFront, Utensils, Wallet
} from "lucide-react";
import { upload as uploadBlob } from "@vercel/blob/client";
import TripOverviewMap, { type TripMapDay } from "@/components/trip-overview-map";
import UsefulInfo from "@/components/useful-info";
import InsuranceInfo from "@/components/insurance-info";
import Phrasebook from "@/components/phrasebook";
import { PhotoContestPanel, PhotoContestShowcase } from "@/components/photo-contest";
import ExpenseDialog from "@/components/expense-dialog";
import TodayDashboard from "@/components/today-dashboard";
import TripChallenges from "@/components/trip-challenges";

type Day = {
  n: number; date: string; city: string; title: string; type: "plane" | "train" | "bus" | "walk";
  from?: string; to?: string; duration?: string; description: string; activities: string[];
  color: string; lat: number; lon: number; hotel: string | string[]; service?: string;
  label?: string; layover?: string;
  flightLegs?: Array<{
    number: string; from: string; to: string; departure: string; arrival: string;
    duration?: string; aircraft: string; trackingUrl: string;
  }>;
};

type SessionUser = { id: string; name: string; initials: string };
type NoteEntry = { text: string; updatedBy: string; updatedAt?: string };
type PhotoEntry = {
  id: string;
  day: number;
  originalName: string;
  contentType: string;
  sizeBytes: number | null;
  addedBy: string;
  createdAt?: string;
  contentUrl: string;
  downloadUrl: string;
  canDelete: boolean;
};
type RestaurantEntry = { id: string; day: number; name: string; addedBy: string; createdAt?: string };
type ExpenseEntry = {
  id: string;
  day: number | null;
  label: string;
  amount: number;
  currency: "EUR" | "UZS";
  payer: string;
  createdAt?: string;
};
type CashMovementEntry = {
  id: string;
  day: number;
  kind: "withdrawal" | "exchange";
  location: string;
  euroAmount: number | null;
  somAmount: number;
  feeEuro: number | null;
  addedBy: string;
  createdAt?: string;
};
type TripData = {
  notes: Array<NoteEntry & { day: number }>;
  restaurants: RestaurantEntry[];
  expenses: ExpenseEntry[];
  cashMovements: CashMovementEntry[];
};
type PhotoUploadState = { day: number; current: number; total: number; progress: number };

async function readJson<T>(response: Response): Promise<T> {
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Operazione non riuscita");
  return result;
}

async function postTripData<T>(body: object) {
  return readJson<T>(await fetch("/api/trip-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
}

function parseLocalizedNumber(value: string) {
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return Number.NaN;
  if (compact.includes(",")) return Number(compact.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ""));
  return Number(compact);
}

const formatSom = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function groupPhotos(entries: PhotoEntry[]) {
  return entries.reduce<Record<number, PhotoEntry[]>>((grouped, photo) => {
    grouped[photo.day] = [...(grouped[photo.day] ?? []), photo];
    return grouped;
  }, {});
}

function photoExtension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  };
  const fromName = file.name.split(".").pop()?.toLowerCase();
  return byType[file.type] ?? (
    fromName && ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(fromName)
      ? fromName
      : null
  );
}

const days: Day[] = [
  { n: 12, label: "PARTENZA", date: "1 AGO", city: "Torino → Istanbul → Tashkent", title: "In viaggio verso l’Uzbekistan", type: "plane", from: "Torino", to: "Tashkent", duration: "10:25 → 00:50 (+1)", description: "Partenza dall’Aeroporto di Torino alle 10:25 con Turkish Airlines. Arrivo a Istanbul alle 14:25, scalo di 4 ore e partenza alle 18:25 verso Tashkent, con arrivo alle 00:50 del 2 agosto. Gli orari sono locali.", activities: ["Check-in all’Aeroporto di Torino", "Coincidenza di 4 ore a Istanbul", "Arrivo a Tashkent il 2 agosto"], color: "#D6663D", lat: 45.2008, lon: 7.6496, hotel: "Notte in volo · arrivo il 2 agosto", service: "Turkish Airlines · TRN / IST / TAS", layover: "4 ore all’Aeroporto di Istanbul (IST)", flightLegs: [
    { number: "TK1310", from: "Aeroporto di Torino (TRN)", to: "Aeroporto di Istanbul (IST)", departure: "10:25", arrival: "14:25", duration: "3 ore", aircraft: "Boeing 737 MAX 8 · fusoliera stretta", trackingUrl: "https://it.flightaware.com/live/flight/THY1310" },
    { number: "TK370", from: "Aeroporto di Istanbul (IST)", to: "Aeroporto Internazionale di Tashkent (TAS)", departure: "18:25", arrival: "00:50 (+1)", duration: "4 ore 25 min", aircraft: "Airbus A330-203 · fusoliera larga", trackingUrl: "https://it.flightaware.com/live/flight/THY370" }
  ] },
  { n: 1, date: "2 AGO", city: "Tashkent → Khiva", title: "La capitale e il volo verso Urgench", type: "plane", from: "Tashkent", to: "Urgench / Khiva", duration: "20:40–22:10", description: "Arrivo a Tashkent alle 00:50, accoglienza, trasferimento e check-in all’Hotel Inspira-S per il riposo. Dalle 10:30 visita guidata della capitale. In serata volo interno per Urgench e trasferimento in auto di circa 40 km fino a Khiva.", activities: ["Complesso Khast Imam", "Madrasa Barak Khan", "Bazaar Chorsu", "Metropolitana di Tashkent", "Piazza dell’Indipendenza"], color: "#D6663D", lat: 41.2995, lon: 69.2401, hotel: ["Inspira-S, Tashkent", "Zarafshon, Khiva"], service: "Guida privata in italiano · cena inclusa" },
  { n: 2, date: "3 AGO", city: "Khiva", title: "La città-museo di Ichan Kala", type: "walk", description: "Visita guidata di mezza giornata nel cuore murato di Khiva. Al termine delle visite, tempo libero e cena in ristorante locale.", activities: ["Ichan Kala", "Kalta Minor", "Kunya Ark", "Madrasa Muhammad Amin Khan", "Moschea Juma", "Palazzo Tosh Hovli"], color: "#715C9D", lat: 41.3784, lon: 60.3605, hotel: "Zarafshon, Khiva", service: "Guida privata in italiano · cena inclusa" },
  { n: 3, date: "4 AGO", city: "Khiva → Bukhara", title: "Nel deserto sulla Via della Seta", type: "train", from: "Khiva", to: "Bukhara", duration: "Circa 6/7 ore", description: "Partenza in treno da Khiva verso Bukhara, attraversando il paesaggio del Kyzylkum. Viaggio senza guida. Arrivo nel pomeriggio e passeggiata orientativa nel centro storico.", activities: ["Viaggio in treno nel Kyzylkum", "Centro storico di Bukhara"], color: "#C4902F", lat: 39.7681, lon: 64.4556, hotel: "Shaxriston, Bukhara", service: "Treno · senza guida · cena inclusa" },
  { n: 4, date: "5 AGO", city: "Bukhara", title: "La città santa dell’Asia Centrale", type: "walk", description: "Giornata di visita guidata tra fortezze, mausolei, moschee e gli antichi mercati coperti.", activities: ["Mausoleo dei Samanidi", "Fortezza Ark", "Moschea Bolo Hauz", "Complesso Poi Kalon", "Mercati coperti di Bukhara", "Chor Minor"], color: "#C4902F", lat: 39.7758, lon: 64.4149, hotel: "Shaxriston, Bukhara", service: "Guida privata in italiano · cena inclusa" },
  { n: 5, date: "6 AGO", city: "Bukhara → Samarcanda", title: "Dal palazzo dell’emiro al Registan", type: "train", from: "Bukhara", to: "Samarcanda", duration: "15:03–16:48", description: "Check-out e visita al palazzo estivo dell’ultimo emiro. Treno per Samarcanda e, dopo cena, Registan illuminato.", activities: ["Sitorai Mokhi Khosa", "Piazza Registan di sera"], color: "#177A78", lat: 39.6542, lon: 66.9597, hotel: "Maridian Plaza, Samarcanda", service: "Trasferimenti privati · cena inclusa" },
  { n: 6, date: "7 AGO", city: "Samarcanda", title: "Le meraviglie di Tamerlano", type: "walk", description: "Intera giornata guidata tra le architetture più celebri della città, seguita da cena in ristorante locale.", activities: ["Mausoleo Gur-e-Amir", "Piazza Registan", "Moschea Bibi Khanum", "Bazaar Siab"], color: "#177A78", lat: 39.6548, lon: 66.9758, hotel: "Maridian Plaza, Samarcanda", service: "Guida privata in italiano · cena inclusa" },
  { n: 7, date: "8 AGO", city: "Samarcanda → Shahrisabz → Samarcanda", title: "La città verde di Amir Temur", type: "bus", from: "Samarcanda", to: "Shahrisabz e ritorno", duration: "Escursione giornaliera", description: "Escursione attraverso il passo montano nella città natale di Amir Temur. Visita delle rovine monumentali e dei complessi funerari, quindi rientro a Samarcanda nel tardo pomeriggio.", activities: ["Palazzo Ak-Saray", "Dorus-Saodat", "Dorut-Tilovat", "Moschea Kok-Gumbaz"], color: "#3D8B68", lat: 39.0578, lon: 66.8342, hotel: "Maridian Plaza, Samarcanda", service: "Guida privata · cena inclusa" },
  { n: 8, date: "9 AGO", city: "Samarcanda → Tashkent", title: "Necropoli, astronomia e carta", type: "train", from: "Samarcanda", to: "Tashkent", duration: "17:40–20:07", description: "Ultimi approfondimenti culturali a Samarcanda. Nel tardo pomeriggio treno per Tashkent, trasferimento in hotel e cena.", activities: ["Necropoli Shah-i-Zinda", "Osservatorio di Ulugh Beg", "Fabbrica della carta di Konigil"], color: "#177A78", lat: 39.674, lon: 66.987, hotel: "Inspira-S, Tashkent", service: "Guida privata · treno · cena inclusa" },
  { n: 9, date: "10 AGO", city: "Tashkent → Kokand → Rishtan → Fergana", title: "Ceramiche e palazzi nella Valle di Fergana", type: "train", from: "Tashkent", to: "Kokand", duration: "08:10–12:29", description: "Treno senza guida verso Kokand. Incontro con l’autista locale, visita del Palazzo Khudoyar Khan e della Moschea del Venerdì; sosta ai laboratori di ceramica blu di Rishtan e proseguimento per Fergana.", activities: ["Palazzo Khudoyar Khan", "Moschea del Venerdì di Kokand", "Laboratori di ceramica di Rishtan"], color: "#A35D55", lat: 40.5286, lon: 70.9425, hotel: "Saroy Garden, Fergana", service: "Autista privato · senza guida · cena inclusa" },
  { n: 10, date: "11 AGO", city: "Fergana → Margilan → Tashkent", title: "La seta della Valle di Fergana", type: "bus", from: "Fergana", to: "Tashkent", duration: "Trasferimento panoramico", description: "Partenza con autista per Margilan. Visita alla produzione tradizionale della seta e al bazar della frutta; rientro a Tashkent con sosta panoramica in montagna.", activities: ["Fabbrica della seta di Margilan", "Bazar della frutta di Margilan", "Passo montano Kamchik"], color: "#A35D55", lat: 40.4711, lon: 71.7247, hotel: "Inspira-S, Tashkent", service: "Autista privato · senza guida · cena inclusa" },
  { n: 11, date: "12 AGO", city: "Tashkent", title: "Tempo libero e cena di arrivederci", type: "bus", from: "Hotel Inspira-S", to: "Aeroporto di Tashkent", duration: "In serata", description: "Mattina e pomeriggio liberi per gli ultimi acquisti e il relax. Camera disponibile fino alle 12:00, oppure fino alle 18:00 con late check-out. Cena di arrivederci e trasferimento in aeroporto per il volo delle 23:50.", activities: ["Tempo libero a Tashkent", "Ultimi acquisti", "Cena di arrivederci"], color: "#D6663D", lat: 41.2995, lon: 69.2401, hotel: "Check-out da Inspira-S", service: "Trasferimento aeroporto · cena inclusa" },
  { n: 13, label: "RIENTRO", date: "13 AGO", city: "Tashkent → Istanbul → Torino", title: "Il viaggio verso casa", type: "plane", from: "Tashkent", to: "Torino", duration: "23:50 (12 AGO) → 09:30", description: "Il rientro inizia alle 23:50 del 12 agosto dall’Aeroporto Internazionale di Tashkent. Arrivo a Istanbul alle 03:15 del 13 agosto, coincidenza di 4 ore e 15 minuti e partenza per Torino alle 07:30. Arrivo previsto alle 09:30. Gli orari sono locali.", activities: ["Partenza da Tashkent il 12 agosto", "Coincidenza di 4 ore e 15 minuti a Istanbul", "Arrivo all’Aeroporto di Torino"], color: "#D6663D", lat: 41.2579, lon: 69.2812, hotel: "Rientro a casa", service: "Turkish Airlines · TAS / IST / TRN", layover: "4 ore 15 min all’Aeroporto di Istanbul (IST)", flightLegs: [
    { number: "TK363", from: "Aeroporto Internazionale di Tashkent (TAS)", to: "Aeroporto di Istanbul (IST)", departure: "23:50 (12 AGO)", arrival: "03:15 (13 AGO)", aircraft: "Airbus A321neo · fusoliera stretta", trackingUrl: "https://it.flightaware.com/live/flight/THY363" },
    { number: "TK1309", from: "Aeroporto di Istanbul (IST)", to: "Aeroporto di Torino (TRN)", departure: "07:30", arrival: "09:30", duration: "3 ore", aircraft: "Boeing 737-800 · fusoliera stretta", trackingUrl: "https://it.flightaware.com/live/flight/THY1309" }
  ] }
];

const icons = { plane: Plane, train: TrainFront, bus: Bus, walk: Navigation };
const tripMapDays: TripMapDay[] = days
  .map((day, index) => ({
    index,
    n: day.n,
    date: day.date,
    city: day.city,
    title: day.title,
    lat: day.lat,
    lon: day.lon,
    color: day.color
  }))
  .filter((day) => day.n <= 11);

export default function Home() {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<"oggi" | "mappa" | "programma" | "ricordi" | "spese" | "info" | "assicurazione" | "frasario" | "sfide">("oggi");
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [notes, setNotes] = useState<Record<number, NoteEntry>>({});
  const [restaurants, setRestaurants] = useState<RestaurantEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovementEntry[]>([]);
  const [photos, setPhotos] = useState<Record<number, PhotoEntry[]>>({});
  const [photoUpload, setPhotoUpload] = useState<PhotoUploadState | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [dataError, setDataError] = useState("");
  const [expenseDay, setExpenseDay] = useState<number | null | undefined>(undefined);
  const day = days[active];
  const Icon = icons[day.type];
  const expenseTotals = useMemo(() => expenses.reduce((totals, expense) => {
    totals[expense.currency] += expense.amount;
    return totals;
  }, { EUR: 0, UZS: 0 }), [expenses]);
  const dayExpenseTotals = useMemo(() => expenses.reduce((totals, expense) => {
    if (expense.day === day.n) totals[expense.currency] += expense.amount;
    return totals;
  }, { EUR: 0, UZS: 0 }), [day.n, expenses]);
  const dayCashMovements = cashMovements.filter((movement) => movement.day === day.n);
  const cashSummary = useMemo(() => cashMovements.reduce((summary, movement) => {
    if (movement.kind === "withdrawal") {
      summary.withdrawnSom += movement.somAmount;
      summary.withdrawalFees += movement.feeEuro ?? 0;
    } else {
      summary.exchangedEuro += movement.euroAmount ?? 0;
      summary.exchangedSom += movement.somAmount;
    }
    return summary;
  }, { withdrawnSom: 0, withdrawalFees: 0, exchangedEuro: 0, exchangedSom: 0 }), [cashMovements]);

  function openDay(index: number) {
    setActive(index);
    setTab("programma");
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/auth/me").then((response) => readJson<{ user: SessionUser }>(response)),
      fetch("/api/trip-data").then((response) => readJson<TripData>(response)),
      fetch("/api/photos").then((response) => readJson<{ photos: PhotoEntry[] }>(response))
    ])
      .then(([identity, tripData, photoData]) => {
        if (cancelled) return;
        setCurrentUser(identity.user);
        setNotes(Object.fromEntries(
          tripData.notes.map(({ day: noteDay, ...note }) => [noteDay, note])
        ));
        setRestaurants(tripData.restaurants);
        setExpenses(tripData.expenses);
        setCashMovements(tripData.cashMovements);
        setPhotos(groupPhotos(photoData.photos));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDataError(error instanceof Error ? error.message : "Dati non disponibili");
        }
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  async function saveNote(dayNumber: number) {
    if (!currentUser) return;
    setSaving(`note-${dayNumber}`);
    setDataError("");
    try {
      const result = await postTripData<{ note: NoteEntry & { day: number } }>({
        action: "note",
        day: dayNumber,
        text: notes[dayNumber]?.text ?? ""
      });
      const { day: savedDay, ...savedNote } = result.note;
      setNotes((previous) => ({ ...previous, [savedDay]: savedNote }));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Nota non salvata");
    } finally {
      setSaving("");
    }
  }

  async function addRestaurant(dayNumber: number) {
    const name = prompt("Nome del locale?")?.trim();
    if (!name || !currentUser) return;

    setSaving("restaurant");
    setDataError("");
    try {
      const result = await postTripData<{ restaurant: RestaurantEntry }>({
        action: "restaurant",
        day: dayNumber,
        name
      });
      setRestaurants((previous) => [...previous, result.restaurant]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Locale non salvato");
    } finally {
      setSaving("");
    }
  }

  async function saveExpense(input: {
    label: string;
    amount: string;
    currency: "EUR" | "UZS";
  }) {
    const label = input.label.trim();
    if (!label || !currentUser) return false;
    const amount = parseLocalizedNumber(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDataError("Inserisci un importo valido maggiore di zero.");
      return false;
    }

    setSaving("expense");
    setDataError("");
    try {
      const result = await postTripData<{ expense: ExpenseEntry }>({
        action: "expense",
        day: expenseDay,
        label,
        amount,
        currency: input.currency
      });
      setExpenses((previous) => [...previous, result.expense]);
      return true;
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Spesa non salvata");
      return false;
    } finally {
      setSaving("");
    }
  }

  async function addWithdrawal(dayNumber: number) {
    if (!currentUser) return;
    const somRaw = prompt("Importo prelevato in SOM (es. 1000000, senza simboli)?");
    if (somRaw === null) return;
    const somAmount = parseLocalizedNumber(somRaw);
    if (!Number.isFinite(somAmount) || somAmount <= 0) {
      setDataError("Inserisci un importo in SOM valido.");
      return;
    }
    const euroRaw = prompt("Importo addebitato in euro? Lascia vuoto se non ancora disponibile.");
    if (euroRaw === null) return;
    const euroAmount = euroRaw.trim() ? parseLocalizedNumber(euroRaw) : null;
    if (euroAmount !== null && (!Number.isFinite(euroAmount) || euroAmount <= 0)) {
      setDataError("Inserisci un importo in euro valido.");
      return;
    }
    const feeRaw = prompt("Commissione bancaria in euro? Lascia vuoto se assente.");
    if (feeRaw === null) return;
    const feeEuro = feeRaw.trim() ? parseLocalizedNumber(feeRaw) : null;
    if (feeEuro !== null && (!Number.isFinite(feeEuro) || feeEuro < 0)) {
      setDataError("Inserisci una commissione valida.");
      return;
    }

    setSaving("withdrawal");
    setDataError("");
    try {
      const result = await postTripData<{ cashMovement: CashMovementEntry }>({
        action: "withdrawal",
        day: dayNumber,
        somAmount,
        euroAmount,
        feeEuro
      });
      setCashMovements((previous) => [...previous, result.cashMovement]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Prelievo non salvato");
    } finally {
      setSaving("");
    }
  }

  async function addExchange(dayNumber: number) {
    if (!currentUser) return;
    const euroRaw = prompt("Euro cambiati?");
    if (euroRaw === null) return;
    const euroAmount = parseLocalizedNumber(euroRaw);
    const somRaw = prompt("SOM ricevuti?");
    if (somRaw === null) return;
    const somAmount = parseLocalizedNumber(somRaw);
    if (!Number.isFinite(euroAmount) || euroAmount <= 0 || !Number.isFinite(somAmount) || somAmount <= 0) {
      setDataError("Inserisci importi euro e SOM validi.");
      return;
    }

    setSaving("exchange");
    setDataError("");
    try {
      const result = await postTripData<{ cashMovement: CashMovementEntry }>({
        action: "exchange",
        day: dayNumber,
        euroAmount,
        somAmount
      });
      setCashMovements((previous) => [...previous, result.cashMovement]);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Cambio non salvato");
    } finally {
      setSaving("");
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!currentUser || photoUpload) return;
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const uploadDay = day.n;
    const invalidFile = files.find((file) => !photoExtension(file) || file.size > 25 * 1024 * 1024);
    if (invalidFile) {
      setDataError(`"${invalidFile.name}" non è un'immagine supportata oppure supera 25 MB.`);
      return;
    }

    setDataError("");
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const extension = photoExtension(file)!;
        setPhotoUpload({ day: uploadDay, current: index + 1, total: files.length, progress: 0 });
        const pathname = `uzbekistan-2026/giorno-${uploadDay}/${crypto.randomUUID()}.${extension}`;
        const blob = await uploadBlob(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/photos/upload",
          clientPayload: JSON.stringify({ day: uploadDay, originalName: file.name }),
          onUploadProgress: ({ percentage }) => {
            setPhotoUpload({
              day: uploadDay,
              current: index + 1,
              total: files.length,
              progress: Math.round(percentage)
            });
          }
        });

        const result = await readJson<{ photo: PhotoEntry }>(await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day: uploadDay,
            pathname: blob.pathname,
            originalName: file.name
          })
        }));
        setPhotos((previous) => ({
          ...previous,
          [uploadDay]: [
            result.photo,
            ...(previous[uploadDay] ?? []).filter((photo) => photo.id !== result.photo.id)
          ]
        }));
      }
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Caricamento foto non riuscito");
    } finally {
      setPhotoUpload(null);
    }
  }

  async function deletePhoto(photo: PhotoEntry) {
    if (!photo.canDelete || !confirm(`Cancellare definitivamente "${photo.originalName}"?`)) return;
    setSaving(`photo-${photo.id}`);
    setDataError("");
    try {
      await readJson<{ deleted: boolean }>(await fetch(`/api/photos/${photo.id}`, {
        method: "DELETE"
      }));
      setPhotos((previous) => ({
        ...previous,
        [photo.day]: (previous[photo.day] ?? []).filter((entry) => entry.id !== photo.id)
      }));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Foto non cancellata");
    } finally {
      setSaving("");
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandMark">UZ</span><div><strong>Via della Seta</strong><small>UZBEKISTAN · 2026</small></div></div>
        <div className="tripDates"><CalendarDays size={17}/><span>1 — 13 agosto</span><i>11 gg tour</i></div>
        <div className="people">
          {currentUser && <span className="currentUser"><i>{currentUser.initials}</i><b>{currentUser.name}</b></span>}
          <div className="avatars"><i>FF</i><i>SI</i><i>MA</i></div>
          <form action="/api/auth/logout" method="post">
            <button className="logoutButton" type="submit" aria-label="Esci" title="Esci">
              <LogOut size={17}/><span>Esci</span>
            </button>
          </form>
        </div>
      </header>

      <section className="hero">
        <div className="heroTexture" />
        <div className="heroCopy">
          <p className="eyebrow">IL NOSTRO VIAGGIO</p>
          <h1>Il nostro viaggio sulla<br/><em>Via della Seta</em></h1>
          <p>Quattro città, infinite storie e un diario tutto nostro.</p>
        </div>
        <div className="routeSummary">
          <div><strong>2.000+</strong><span>KM DA PERCORRERE</span></div>
          <div><strong>8</strong><span>LOCALITÀ</span></div>
          <div><strong>3</strong><span>VIAGGIATORI</span></div>
        </div>
      </section>

      <nav className="tabs">
        <button className={tab === "oggi" ? "active" : ""} onClick={() => setTab("oggi")}><House size={18}/> Oggi</button>
        <button className={tab === "mappa" ? "active" : ""} onClick={() => setTab("mappa")}><Map size={18}/> Mappa</button>
        <button className={tab === "programma" ? "active" : ""} onClick={() => setTab("programma")}><CalendarDays size={18}/> Programma</button>
        <button className={tab === "ricordi" ? "active" : ""} onClick={() => setTab("ricordi")}><Camera size={18}/> Ricordi <b>{Object.values(photos).flat().length}</b></button>
        <button className={tab === "spese" ? "active" : ""} onClick={() => setTab("spese")}><Wallet size={18}/> Spese <b>€ {expenseTotals.EUR} · {formatSom.format(expenseTotals.UZS)} UZS</b></button>
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}><Info size={18}/> Info utili</button>
        <button className={tab === "assicurazione" ? "active" : ""} onClick={() => setTab("assicurazione")}><ShieldCheck size={18}/> Polizza</button>
        <button className={tab === "frasario" ? "active" : ""} onClick={() => setTab("frasario")}><Languages size={18}/> Frasi</button>
        <button className={tab === "sfide" ? "active" : ""} onClick={() => setTab("sfide")}><Sparkles size={18}/> Sfide</button>
      </nav>
      {dataLoading && <p className="dataStatus">Sincronizzazione con il diario condiviso…</p>}
      {dataError && <p className="dataError" role="alert">{dataError}</p>}

      {tab === "oggi" && (
        <TodayDashboard
          days={days}
          expenses={expenses}
          photos={photos}
          onOpenDay={(dayNumber) => openDay(days.findIndex((tripDay) => tripDay.n === dayNumber))}
          onOpenChallenges={() => setTab("sfide")}
        />
      )}

      {tab === "mappa" && (
        <section className="overviewPage">
          <div className="overviewHead">
            <div>
              <span>LA ROTTA IN UZBEKISTAN</span>
              <h2>Undici giorni, una mappa</h2>
              <p>Tocca un numero sulla mappa o una tappa qui sotto per aprire il programma di quel giorno.</p>
            </div>
            <a href="https://www.openstreetmap.org/#map=6/41.5/64.5" target="_blank" rel="noreferrer">
              Apri la mappa completa <ExternalLink size={14}/>
            </a>
          </div>
          <div className="overviewMap">
            <TripOverviewMap days={tripMapDays} onSelect={openDay}/>
          </div>
          <div className="overviewDayList" aria-label="Giorni del tour">
            {tripMapDays.map((mapDay) => (
              <button key={mapDay.n} onClick={() => openDay(mapDay.index)}>
                <span style={{ background: mapDay.color }}>{mapDay.n}</span>
                <span><small>{mapDay.date}</small><strong>{mapDay.city}</strong></span>
                <ChevronRight size={16}/>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === "programma" && <div className="dashboard">
        <aside className="timeline">
          <div className="sectionTitle"><div><span>ITINERARIO</span><h2>Giorno per giorno</h2></div><span>{active + 1} / {days.length}</span></div>
          <div className="dayList">
            {days.map((d, i) => {
              const DIcon = icons[d.type];
              return <button key={d.n} className={`dayRow ${active === i ? "selected" : ""}`} onClick={() => setActive(i)}>
                <span className="dayDate"><b>{d.date.split(" ")[0]}</b>{d.date.split(" ")[1]}</span>
                <span className="line"><i style={{background:d.color}}></i></span>
                <span className="dayInfo"><small>{d.label ?? `GIORNO ${d.n}`}</small><strong>{d.city}</strong><em><DIcon size={13}/>{d.title}</em></span>
                <ChevronRight size={17}/>
              </button>
            })}
          </div>
        </aside>

        <section className="detail">
          <div className="detailHead">
            <div>
              <span className="tag" style={{color:day.color}}>{day.label ?? `GIORNO ${day.n}`} · {day.date}</span>
              <h2>{day.title}</h2>
              <p>
                <MapPin size={16}/>
                <span className="cityLinks">
                  {day.city.split(" → ").map((cityName, cityIndex) => (
                    <Fragment key={`${cityName}-${cityIndex}`}>
                      {cityIndex > 0 && <ArrowRight size={12}/>}
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(cityName)}`} target="_blank" rel="noreferrer">{cityName}<ExternalLink size={11}/></a>
                    </Fragment>
                  ))}
                </span>
              </p>
            </div>
            <div className="pager"><button disabled={active===0} onClick={()=>setActive(active-1)}><ArrowLeft size={17}/></button><button disabled={active===days.length-1} onClick={()=>setActive(active+1)}><ArrowRight size={17}/></button></div>
          </div>
          {day.from && <div className="transfer">
            <span className="transport"><Icon size={21}/></span>
            <div><small>TRASFERIMENTO</small><strong>{day.from} <ArrowRight size={15}/> {day.to}</strong></div>
            <span><Clock3 size={15}/>{day.duration}</span>
          </div>}
          <p className="description">{day.description}</p>
          {day.flightLegs && (
            <section className="flightMonitor" aria-label="Monitoraggio dei voli">
              <div className="flightMonitorHead">
                <span><Plane size={18}/></span>
                <div><small>MONITORAGGIO VOLI</small><strong>Aggiornamenti in tempo reale su FlightAware</strong></div>
              </div>
              {day.layover && <div className="flightLayover"><Clock3 size={14}/><span><small>SCALO A ISTANBUL</small><strong>{day.layover}</strong></span></div>}
              <div className="flightMonitorGrid">
                {day.flightLegs.map((leg) => (
                  <a key={leg.number} href={leg.trackingUrl} target="_blank" rel="noreferrer">
                    <span className="flightNumber">{leg.number}</span>
                    <span className="flightAirports"><b>{leg.from}</b><ArrowRight size={14}/><b>{leg.to}</b></span>
                    <span className="flightTimes"><Clock3 size={12}/>{leg.departure} → {leg.arrival}{leg.duration && <b>{leg.duration}</b>}</span>
                    <span className="flightAircraft"><Plane size={12}/>{leg.aircraft}</span>
                    <span className="flightTrack">Segui il volo <ExternalLink size={13}/></span>
                  </a>
                ))}
              </div>
            </section>
          )}
          <div className="stayInfo">
            <span><CircleUserRound size={16}/>{day.service}</span>
            <span><MapPin size={16}/>{day.flightLegs
              ? <strong>{Array.isArray(day.hotel) ? day.hotel.join(" · ") : day.hotel}</strong>
              : (Array.isArray(day.hotel) ? day.hotel : [day.hotel]).map((hotel, hotelIndex) => (
                  <Fragment key={hotel}>
                    {hotelIndex > 0 && <span aria-hidden="true"> · </span>}
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${hotel.replace(/^Check-out da /, "")} hotel Uzbekistan`)}`} target="_blank" rel="noreferrer"><strong>{hotel}</strong><ExternalLink size={12}/></a>
                  </Fragment>
                ))
            }</span>
          </div>
          <div className="activityGrid">
            <div className="activities">
              <h3>Da non perdere</h3>
              {day.activities.map((a, i)=><a key={a} href={`https://www.google.com/search?q=${encodeURIComponent(a+" Uzbekistan")}`} target="_blank"><span>{String(i+1).padStart(2,"0")}</span><strong>{a}</strong><ExternalLink size={15}/></a>)}
            </div>
            <div className="mapCard">
              <iframe suppressHydrationWarning title={`Mappa di ${day.city}`} src={`https://www.openstreetmap.org/export/embed.html?bbox=${day.lon-.06}%2C${day.lat-.04}%2C${day.lon+.06}%2C${day.lat+.04}&layer=mapnik&marker=${day.lat}%2C${day.lon}`} />
              <a href={`https://www.google.com/maps/search/?api=1&query=${day.lat},${day.lon}`} target="_blank"><MapPin size={15}/> Apri la mappa <ExternalLink size={13}/></a>
            </div>
          </div>
          <div className="journal">
            <div><MessageCircle size={18}/><strong>Nota del giorno</strong></div>
            <textarea
              placeholder="Scrivi qui un ricordo, un consiglio, una curiosità…"
              value={notes[day.n]?.text ?? ""}
              disabled={!currentUser || dataLoading}
              onChange={e => setNotes((previous) => ({
                ...previous,
                [day.n]: { text: e.target.value, updatedBy: currentUser!.name }
              }))}
              onBlur={() => saveNote(day.n)}
            />
            {saving === `note-${day.n}`
              ? <small className="auditBy">Salvataggio…</small>
              : notes[day.n]?.text && <small className="auditBy">Ultima modifica: {notes[day.n].updatedBy}</small>}
          </div>
          <div className="quickActions">
            <label className={!currentUser || photoUpload ? "disabled" : ""}>
              {photoUpload?.day === day.n ? <LoaderCircle className="spin" size={18}/> : <Camera size={18}/>}
              <span>Aggiungi foto<small>{photoUpload?.day === day.n
                ? `Foto ${photoUpload.current}/${photoUpload.total} · ${photoUpload.progress}%`
                : `${photos[day.n]?.length ?? 0} caricate`
              }</small></span>
              <Plus size={17}/>
              <input type="file" accept="image/*,.heic,.heif" multiple disabled={!currentUser || Boolean(photoUpload)} onChange={upload}/>
            </label>
            <button disabled={!currentUser || Boolean(saving)} onClick={() => addRestaurant(day.n)}><Utensils size={18}/><span>Aggiungi locale<small>{restaurants.filter(r=>r.day===day.n).length} salvati</small></span><Plus size={17}/></button>
            <button disabled={!currentUser || Boolean(saving)} onClick={() => setExpenseDay(day.n)}><ReceiptText size={18}/><span>Aggiungi spesa<small>Tappa: € {dayExpenseTotals.EUR.toFixed(2)} · {formatSom.format(dayExpenseTotals.UZS)} UZS</small></span><Plus size={17}/></button>
            <button disabled={!currentUser || Boolean(saving)} onClick={() => addWithdrawal(day.n)}><Banknote size={18}/><span>Aggiungi prelievo<small>{dayCashMovements.filter(movement => movement.kind === "withdrawal").length} registrati</small></span><Plus size={17}/></button>
            <button disabled={!currentUser || Boolean(saving)} onClick={() => addExchange(day.n)}><ArrowRightLeft size={18}/><span>Aggiungi cambio<small>{dayCashMovements.filter(movement => movement.kind === "exchange").length} registrati</small></span><Plus size={17}/></button>
          </div>
          <PhotoContestPanel day={day.n} photoCount={photos[day.n]?.length ?? 0}/>
          {restaurants.filter((restaurant) => restaurant.day === day.n).length > 0 && (
            <div className="restaurantList">
              {restaurants.filter((restaurant) => restaurant.day === day.n).map((restaurant) => (
                <span key={restaurant.id}>
                  <Utensils size={13}/><b>{restaurant.name}</b><small>Aggiunto da {restaurant.addedBy}</small>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>}

      {tab === "ricordi" && <section className="collection">
        <div className="sectionTitle"><div><span>DIARIO VISIVO</span><h2>I nostri ricordi</h2></div></div>
        <PhotoContestShowcase/>
        {Object.values(photos).flat().length === 0 ? <div className="empty"><Camera size={36}/><h3>La galleria aspetta il primo ricordo</h3><p>Apri una giornata del programma e aggiungi le tue foto.</p><button onClick={()=>setTab("programma")}>Vai al programma</button></div> :
        <div className="photoGrid">{Object.entries(photos).flatMap(([d,entries])=>entries.map(photo=>
          <figure key={photo.id}>
            <img src={photo.contentUrl} alt={photo.originalName} loading="lazy"/>
            <div className="photoActions">
              <a href={photo.downloadUrl} aria-label={`Scarica ${photo.originalName}`} title="Scarica">
                <Download size={17}/>
              </a>
              {photo.canDelete && <button
                type="button"
                onClick={() => deletePhoto(photo)}
                disabled={saving === `photo-${photo.id}`}
                aria-label={`Cancella ${photo.originalName}`}
                title="Cancella"
              >
                {saving === `photo-${photo.id}` ? <LoaderCircle className="spin" size={17}/> : <Trash2 size={17}/>}
              </button>}
            </div>
            <figcaption>Giorno {d} · {photo.addedBy}</figcaption>
          </figure>))}</div>}
      </section>}

      {tab === "spese" && <section className="collection expensesPage">
        <div className="expenseHero">
          <span>SPESE DEL GRUPPO</span>
          <h2>Totali per valuta</h2>
          <div className="expenseCurrencyTotals">
            <div><small>EURO</small><strong>€ {expenseTotals.EUR.toFixed(2)}</strong></div>
            <div><small>SOM UZBEKI</small><strong>{formatSom.format(expenseTotals.UZS)} UZS</strong></div>
          </div>
          <p>A persona: € {(expenseTotals.EUR/3).toFixed(2)} · {formatSom.format(expenseTotals.UZS/3)} UZS</p>
        </div>
        <div className="expenseList">{expenses.map((e)=><div key={e.id}><span className="receipt"><ReceiptText size={18}/></span><span><strong>{e.label}</strong><small>Pagato da {e.payer} · {e.currency === "EUR" ? "Euro" : "Som"}{e.day !== null ? ` · ${days.find((tripDay) => tripDay.n === e.day)?.date ?? `Giorno ${e.day}`}` : ""}</small></span><b>{e.currency === "EUR" ? `€ ${e.amount.toFixed(2)}` : `${formatSom.format(e.amount)} UZS`}</b></div>)}</div>
        <button className="primary" disabled={!currentUser || Boolean(saving)} onClick={() => setExpenseDay(null)}><Plus size={17}/> {saving === "expense" ? "Salvataggio…" : "Nuova spesa"}</button>
        <div className="cashSection">
          <div className="sectionTitle"><div><span>GESTIONE CONTANTI</span><h2>Prelievi e cambi</h2></div></div>
          <div className="cashSummary">
            <div><Banknote size={19}/><span><small>SOM PRELEVATI</small><strong>{formatSom.format(cashSummary.withdrawnSom)} UZS</strong></span></div>
            <div><ArrowRightLeft size={19}/><span><small>EURO CAMBIATI</small><strong>€ {cashSummary.exchangedEuro.toFixed(2)}</strong></span></div>
            <div><Wallet size={19}/><span><small>SOM DAL CAMBIO</small><strong>{formatSom.format(cashSummary.exchangedSom)} UZS</strong></span></div>
          </div>
          {cashMovements.length === 0
            ? <p className="cashEmpty">Nessun prelievo o cambio registrato.</p>
            : <div className="cashMovementList">{cashMovements.map((movement) => {
                const movementDay = days.find((tripDay) => tripDay.n === movement.day);
                const rate = movement.euroAmount ? movement.somAmount / movement.euroAmount : null;
                return <div key={`${movement.kind}-${movement.id}`}>
                  <span className={`cashIcon ${movement.kind}`}><Banknote size={18}/></span>
                  <span>
                    <strong>{movement.kind === "withdrawal" ? "Prelievo ATM" : "Cambio euro–SOM"}</strong>
                    <small>{movement.location} · {movementDay?.date} · Inserito da {movement.addedBy}</small>
                    {movement.kind === "withdrawal" && movement.feeEuro !== null && <small>Commissione: € {movement.feeEuro.toFixed(2)}</small>}
                    {movement.kind === "exchange" && rate !== null && <small>Cambio: {formatSom.format(rate)} UZS per €</small>}
                  </span>
                  <b>{movement.euroAmount !== null && <small>€ {movement.euroAmount.toFixed(2)}</small>}{formatSom.format(movement.somAmount)} UZS</b>
                </div>;
              })}</div>
          }
        </div>
      </section>}

      {tab === "info" && <UsefulInfo/>}
      {tab === "assicurazione" && <InsuranceInfo/>}
      {tab === "frasario" && <Phrasebook/>}
      {tab === "sfide" && <TripChallenges/>}

      <ExpenseDialog
        open={expenseDay !== undefined}
        dayLabel={expenseDay == null ? undefined : days.find((tripDay) => tripDay.n === expenseDay)?.date}
        saving={saving === "expense"}
        onClose={() => setExpenseDay(undefined)}
        onSave={saveExpense}
      />
    </main>
  );
}
