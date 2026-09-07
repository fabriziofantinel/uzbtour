"use client";

import dynamic from "next/dynamic";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  BedDouble,
  Building2,
  Bus,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Check,
  Download,
  ExternalLink,
  FileText,
  Info,
  Languages,
  LoaderCircle,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  Navigation,
  Plane,
  ReceiptText,
  Phone,
  Share2,
  ShieldAlert,
  Sparkles,
  Star,
  TrainFront,
  Trash2,
  Utensils,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import ExpenseDialog from "@/components/expense-dialog";
import CashMovementDialog from "@/components/cash-movement-dialog";
import type { TripMapDay } from "@/components/trip-overview-map";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";
import { accessibleBrandBackground, accessibleBrandColor, agencyLogoSource } from "@/lib/platform/branding-ui";
import { resilientMutation, uuidV7 } from "@/lib/pwa/offline-queue";
import { calculateExpenseBalances } from "@/lib/finance-calculations";
import PwaCompanion from "@/components/pwa-companion";
import OperationalChat from "@/components/operational-chat";
import OperationalAlertForm from "@/components/operational-alert-form";
import PostTripReview from "@/components/post-trip-review";
import { useAppConfirm } from "@/components/app-confirm-dialog";
import { downloadTripForOffline, type OfflinePackageState } from "@/lib/pwa/offline-package";

const TripOverviewMap = dynamic(() => import("@/components/trip-overview-map"), {
  ssr: false,
  loading: () => (
    <div className="componentLoading" role="status">
      Caricamento della mappa…
    </div>
  ),
});
const PlatformTripChallenges = dynamic(() => import("@/components/platform-trip-challenges"), {
  loading: () => (
    <div className="componentLoading" role="status">
      Caricamento delle sfide…
    </div>
  ),
});

type Tab =
  | "mappa"
  | "programma"
  | "ricordi"
  | "documenti"
  | "spese"
  | "info"
  | "frasario"
  | "sfide"
  | "sos"
  | "chat"
  | "assicurazione"
  | "valutazione";
type Day = Experience["days"][number];
const colors = ["#D6663D", "#715C9D", "#C4902F", "#177A78", "#3D8B68", "#A35D55"];
const wholeNumber = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const travelerPreferenceChangedEvent = "smf-traveler-preference-changed";

function subscribeToTravelerPreferences(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(travelerPreferenceChangedEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(travelerPreferenceChangedEvent, onStoreChange);
  };
}

function useTravelerPreference(key: string) {
  return useSyncExternalStore(
    subscribeToTravelerPreferences,
    () => localStorage.getItem(key) === "1",
    () => false,
  );
}
const usefulSections = [
  { key: "ambasciata", title: "Ambasciata" },
  { key: "salute", title: "Salute" },
  { key: "documenti", title: "Documenti" },
  { key: "abbigliamento", title: "Abbigliamento" },
  { key: "usi locali", title: "Usi locali" },
  { key: "come muoversi", title: "Come muoversi" },
  { key: "usi e tradizioni", title: "Usi e tradizioni" },
  { key: "capire il paese", title: "Capire il paese" },
] as const;
function formatClock(timeZone: string, now: Date) {
  try {
    return new Intl.DateTimeFormat("it-IT", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
      now,
    );
  } catch {
    return "--:--";
  }
}

function dateParts(value: string) {
  if (!value) return { day: "--", month: "---", full: "Data da confermare" };
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("it-IT", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" })
      .format(date)
      .replace(".", "")
      .toUpperCase(),
    full: new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" }).format(date),
  };
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}
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
  return `1 € = ${wholeNumber.format(localAmount / euroAmount)} ${localCurrency}`;
}
function todayInTimeZone(timeZone: string, value = new Date()) {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      value,
    );
  } catch {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
  const normalizedTitle = item.title
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .trim();
  const matched = day.sites.find((site) => {
    const name = site.name
      .toLocaleLowerCase("it")
      .replace(/[^a-z0-9à-ÿ]+/g, " ")
      .trim();
    return name === normalizedTitle || name.includes(normalizedTitle) || normalizedTitle.includes(name);
  });
  if (matched) return matched;
  const visitIndex = day.items.filter((entry) => entry.type === "visit").findIndex((entry) => entry.id === item.id);
  return visitIndex >= 0 ? (day.sites[visitIndex] ?? null) : null;
}

function RatingStars({
  value,
  busy,
  label,
  onRate,
}: {
  value: number | null;
  busy: boolean;
  label: string;
  onRate: (rating: number) => void;
}) {
  return (
    <div className="programmeRating">
      <span>{value ? "La tua valutazione" : "Valuta questa tappa"}</span>
      <div role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            type="button"
            key={rating}
            className={value != null && rating <= value ? "active" : ""}
            disabled={busy}
            onClick={() => onRate(rating)}
            aria-label={`${rating} ${rating === 1 ? "stella" : "stelle"}`}
            aria-pressed={value === rating}
          >
            <Star />
          </button>
        ))}
      </div>
      {busy && <LoaderCircle className="spin" />}
    </div>
  );
}

export default function TravelExperience({
  initialExperience,
  userName,
  isAgencyAdmin = false,
}: {
  initialExperience: Experience;
  userName: string;
  isAgencyAdmin?: boolean;
}) {
  const { confirm: confirmAction, dialog: confirmDialog } = useAppConfirm();
  const [experience, setExperience] = useState(initialExperience);
  const [tab, setTab] = useState<Tab>("programma");
  const [active, setActive] = useState(() =>
    currentDayIndex(initialExperience.days, initialExperience.journey.timezone),
  );
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [officialEurRate, setOfficialEurRate] = useState<number | null>(null);
  const [expenseDayId, setExpenseDayId] = useState<string | null | undefined>(undefined);
  const [cashDialogKind, setCashDialogKind] = useState<"withdrawal" | "exchange" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [memoryDayFilter, setMemoryDayFilter] = useState<number | "all">("all");
  const [isOnline, setIsOnline] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [offlinePackage, setOfflinePackage] = useState<OfflinePackageState>("idle");
  const [offlineDocumentIds, setOfflineDocumentIds] = useState<Set<string>>(() => new Set());
  const [offlineProgress, setOfflineProgress] = useState({ done: 0, total: 0 });
  const largeText = useTravelerPreference("smf-large-text");
  const simpleMode = useTravelerPreference("smf-simple-mode");
  const [chatScope, setChatScope] = useState<"trip" | "group" | "traveler">("group");
  const contentRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const firstTabRender = useRef(true);
  const gestureStart = useRef<{ x: number; y: number; atTop: boolean } | null>(null);
  const day = experience.days[active] ?? experience.days[0];
  const postTripReviewAvailable = useMemo(() => {
    return todayInTimeZone(experience.journey.timezone, now) >= addCalendarDays(experience.journey.endsOn, 2);
  }, [experience.journey.endsOn, experience.journey.timezone, now]);
  const photosByDay = useMemo(
    () =>
      experience.photos.reduce<Record<number, Experience["photos"]>>((all, photo) => {
        all[photo.dayNumber] = [...(all[photo.dayNumber] || []), photo];
        return all;
      }, {}),
    [experience.photos],
  );
  const memoryDays = useMemo(
    () =>
      Object.keys(photosByDay)
        .map(Number)
        .sort((left, right) => left - right),
    [photosByDay],
  );
  const visiblePhotos = useMemo(
    () =>
      memoryDayFilter === "all"
        ? experience.photos
        : experience.photos.filter((photo) => photo.dayNumber === memoryDayFilter),
    [experience.photos, memoryDayFilter],
  );
  const travelDocuments = useMemo(
    () =>
      experience.days.flatMap((entry) => [
        ...entry.documents.map((document) => ({
          ...document,
          dayNumber: entry.number,
          dayDate: entry.date,
          dayTitle: entry.title,
          itemTitle: document.description || "Documento della giornata",
          itemType: "document",
        })),
        ...entry.items.flatMap((item) =>
          item.tickets.map((ticket) => ({
            ...ticket,
            dayNumber: entry.number,
            dayDate: entry.date,
            dayTitle: entry.title,
            itemTitle: item.title,
            itemType: item.type,
          })),
        ),
      ]),
    [experience.days],
  );
  const offlineResourceUrls = useMemo(() => {
    const logo = agencyLogoSource(experience.journey.agencyBranding.logoUrl, experience.journey.agencyId);
    return [
      `/viaggio?partenza=${experience.journey.departureId}`,
      `/api/traveler/trip-data?partenza=${experience.journey.departureId}`,
      ...(logo ? [logo] : []),
      ...travelDocuments.map((document) => document.downloadUrl),
    ];
  }, [
    experience.journey.agencyBranding.logoUrl,
    experience.journey.agencyId,
    experience.journey.departureId,
    travelDocuments,
  ]);
  const localCurrency = experience.journey.destinationCurrency || "EUR";
  // Se il preventivo non indica la valuta, EUR consente comunque di registrare prelievi e cambi senza bloccare il gruppo.
  const hasValidatedLocalCurrency = Boolean(localCurrency);
  const localTimeZone = experience.journey.destinationTimeZone || experience.journey.timezone;
  useEffect(() => {
    let cancelled = false;
    if (!("caches" in window)) return;
    void Promise.all(
      travelDocuments.map(async (document) => {
        const request = new Request(new URL(document.downloadUrl, window.location.origin), { credentials: "include" });
        return (await caches.match(request)) ? document.id : null;
      }),
    ).then((cached) => {
      if (!cancelled) setOfflineDocumentIds(new Set(cached.filter((id): id is string => Boolean(id))));
    });
    return () => {
      cancelled = true;
    };
  }, [travelDocuments]);
  const displayedUsefulInfo = useMemo(
    () =>
      usefulSections.map((section) => {
        const item = experience.usefulInfo.find((candidate) =>
          `${candidate.category} ${candidate.title}`.toLocaleLowerCase("it").includes(section.key),
        );
        return {
          title: section.title,
          body: item?.body || "Informazione in aggiornamento da parte dell’agenzia.",
          phone: item?.phone || "",
          sourceName: item?.sourceName || "",
          sourceUrl: item?.sourceUrl || item?.url || "",
          verifiedAt: item?.verifiedAt || "",
          reviewStatus: item?.reviewStatus || "needs_review",
          disclaimer: item?.disclaimer || "",
        };
      }),
    [experience.usefulInfo],
  );
  const emergencyInfo = useMemo(
    () =>
      experience.usefulInfo.find((item) =>
        `${item.category} ${item.title}`.toLocaleLowerCase("it").includes("numeri di emergenza"),
      ),
    [experience.usefulInfo],
  );

  async function acknowledgeNotice(noticeId: string) {
    setSaving(`notice-${noticeId}`);
    setError("");
    try {
      const response = await fetch("/api/traveler/change-notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeId, clientOperationId: uuidV7() }),
      });
      if (!response.ok) throw new Error("Presa visione non registrata");
      setExperience((current) => ({
        ...current,
        changeNotices: current.changeNotices.map((notice) =>
          notice.id === noticeId ? { ...notice, readAt: new Date().toISOString() } : notice,
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Presa visione non registrata");
    } finally {
      setSaving("");
    }
  }
  const localFormatter = useMemo(
    () =>
      new Intl.NumberFormat("it-IT", {
        maximumFractionDigits: new Intl.NumberFormat("it-IT", {
          style: "currency",
          currency: localCurrency,
        }).resolvedOptions().maximumFractionDigits,
      }),
    [localCurrency],
  );
  const totals = useMemo(
    () =>
      experience.expenses.reduce(
        (sum, expense) => {
          if (expense.currency === "EUR") sum.EUR += expense.amount;
          else if (expense.currency === localCurrency) sum.local += expense.amount;
          return sum;
        },
        { EUR: 0, local: 0 },
      ),
    [experience.expenses, localCurrency],
  );
  const appliedEurRate = useMemo(() => {
    const converted = experience.cashMovements.filter(
      (movement) => movement.euroAmount != null && movement.euroAmount > 0,
    );
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
  const expenseBalances = useMemo(
    () => calculateExpenseBalances(experience.journey.travelers, experience.expenses),
    [experience.expenses, experience.journey.travelers],
  );
  const operationalPoints = useMemo<TripMapDay[]>(() => {
    const points = experience.days.flatMap((entry, dayIndex) =>
      [
        ...entry.cities
          .filter((city) => city.latitude != null && city.longitude != null)
          .map((city) => ({ title: city.name, city: city.name, lat: city.latitude!, lon: city.longitude! })),
        ...entry.items
          .filter((item) => item.latitude != null && item.longitude != null)
          .map((item) => ({
            title: item.title,
            city: entry.city || item.title,
            lat: item.latitude!,
            lon: item.longitude!,
          })),
        ...entry.sites
          .filter((site) => site.latitude != null && site.longitude != null)
          .map((site) => ({
            title: site.name,
            city: site.city || entry.city,
            lat: site.latitude!,
            lon: site.longitude!,
          })),
        ...entry.hotels
          .filter((hotel) => hotel.latitude != null && hotel.longitude != null)
          .map((hotel) => ({
            title: hotel.name,
            city: hotel.city || entry.city,
            lat: hotel.latitude!,
            lon: hotel.longitude!,
          })),
      ].map((point) => ({ ...point, dayIndex, dayNumber: entry.number, date: dateParts(entry.date).full })),
    );
    return [
      ...new globalThis.Map(
        points.map((point) => [`${point.dayNumber}:${point.lat}:${point.lon}:${point.title}`, point] as const),
      ).values(),
    ].map((point, index) => ({
      index,
      n: point.dayNumber,
      date: point.date,
      color: colors[point.dayIndex % colors.length],
      title: point.title,
      city: point.city,
      lat: point.lat,
      lon: point.lon,
    }));
  }, [experience.days]);

  function trackAnalytics(
    eventName: "traveler_session" | "programme_view" | "document_list_view" | "document_download",
    properties: Record<string, string | number | boolean | null> = {},
  ) {
    try {
      const sessionKey = "smf-analytics-session";
      let sessionId = sessionStorage.getItem(sessionKey);
      if (!sessionId) {
        sessionId = uuidV7();
        sessionStorage.setItem(sessionKey, sessionId);
      }
      const dedupeKey = `smf-analytics:${sessionId}:${experience.journey.departureId}:${eventName}:${properties.documentId ?? day.id}`;
      if (sessionStorage.getItem(dedupeKey)) return;
      sessionStorage.setItem(dedupeKey, "1");
      void fetch("/api/traveler/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          departureId: experience.journey.departureId,
          partyId: experience.journey.partyId,
          dayId: day?.id ?? null,
          eventName,
          sessionId,
          clientOperationId: uuidV7(),
          properties,
        }),
      })
        .then((response) => {
          if (!response.ok) sessionStorage.removeItem(dedupeKey);
        })
        .catch(() => sessionStorage.removeItem(dedupeKey));
    } catch {
      /* Le analytics non devono interrompere l'esperienza di viaggio. */
    }
  }

  useEffect(() => {
    let activeRequest = true;
    if (!hasValidatedLocalCurrency || localCurrency === "EUR") {
      return;
    }
    fetch(`/api/exchange-rate?currency=${encodeURIComponent(localCurrency)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { rate?: number } | null) => {
        if (activeRequest && result?.rate && Number.isFinite(result.rate)) setOfficialEurRate(result.rate);
      })
      .catch(() => undefined);
    return () => {
      activeRequest = false;
    };
  }, [hasValidatedLocalCurrency, localCurrency]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const restoreTab = () => {
      const requestedTab = new URLSearchParams(window.location.search).get("tab");
      if (
        [
          "programma",
          "documenti",
          "spese",
          "mappa",
          "sfide",
          "info",
          "frasario",
          "sos",
          "chat",
          "assicurazione",
          "valutazione",
        ].includes(requestedTab || "") &&
        !(requestedTab === "sfide" && experience.experienceProfile === "essential")
      ) {
        setTab(requestedTab as Tab);
      } else {
        setTab("programma");
      }
    };
    restoreTab();
    window.addEventListener("popstate", restoreTab);
    return () => window.removeEventListener("popstate", restoreTab);
  }, [experience.experienceProfile]);

  useEffect(() => {
    trackAnalytics("traveler_session", { entryTab: tab });
    if (tab === "programma") trackAnalytics("programme_view", { dayNumber: day.number });
    if (tab === "documenti") trackAnalytics("document_list_view", { documentCount: travelDocuments.length });
    // Il tracciamento è intenzionalmente legato all'apertura della sezione, non allo scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, day.id, experience.journey.departureId]);

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
    let current = true;
    void Promise.all(
      offlineResourceUrls.map((url) =>
        caches.match(new Request(new URL(url, window.location.origin), { credentials: "include" })),
      ),
    )
      .then((entries) => {
        if (current && entries.every(Boolean)) setOfflinePackage("ready");
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [offlineResourceUrls]);

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
  function selectTab(nextTab: Tab) {
    if (nextTab === "sfide" && experience.experienceProfile === "essential") nextTab = "programma";
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "programma") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    if (nextTab !== "sfide") url.searchParams.delete("sfida");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function openProgramme() {
    selectDay(currentDayIndex(experience.days, experience.journey.timezone));
    selectTab("programma");
  }
  async function postJournal(body: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      departureId: experience.journey.departureId,
      partyId: experience.journey.partyId,
      ...body,
    };
    const offlineKind = body.action === "cash" ? "cash" : null;
    if (offlineKind) {
      const result = await resilientMutation({
        kind: offlineKind,
        url: "/api/traveler/journal",
        method: "POST",
        body: payload,
      });
      if (result.queued)
        return {
          queued: true,
          movement: { id: String(payload.clientOperationId), createdAt: new Date().toISOString() },
        };
      const response = result.response!;
      const responseBody = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(responseBody.error || "Salvataggio non riuscito");
      return responseBody;
    }
    const response = await fetch("/api/traveler/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error || "Salvataggio non riuscito");
    return result;
  }
  async function saveRating(dayId: string, targetType: "itinerary_item" | "hotel", targetId: string, rating: number) {
    const busyKey = `rating-${targetType}-${targetId}`;
    setSaving(busyKey);
    setError("");
    try {
      const result = await resilientMutation({
        kind: "feedback",
        url: "/api/traveler/feedback",
        method: "POST",
        body: {
          departureId: experience.journey.departureId,
          partyId: experience.journey.partyId,
          dayId,
          targetType,
          targetId,
          rating,
          clientOperationId: uuidV7(),
        },
      });
      if (!result.queued && !result.response?.ok) throw new Error("Valutazione non salvata");
      setExperience((current) => ({
        ...current,
        days: current.days.map((entry) =>
          entry.id !== dayId
            ? entry
            : {
                ...entry,
                items:
                  targetType === "itinerary_item"
                    ? entry.items.map((item) => (item.id === targetId ? { ...item, rating } : item))
                    : entry.items,
                hotels:
                  targetType === "hotel"
                    ? entry.hotels.map((hotel) => (hotel.id === targetId ? { ...hotel, rating } : hotel))
                    : entry.hotels,
              },
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Valutazione non salvata");
    } finally {
      setSaving("");
    }
  }
  async function saveNote() {
    if (!day) return;
    const note = experience.notes.find((entry) => entry.dayId === day.id);
    setSaving(`note-${day.id}`);
    setError("");
    try {
      const result = (await postJournal({ action: "note", dayId: day.id, text: note?.text || "" })) as {
        note: { id: string; updatedAt: string };
      };
      setExperience((current) => ({
        ...current,
        notes: current.notes.map((entry) =>
          entry.dayId === day.id ? { ...entry, id: result.note.id, updatedAt: result.note.updatedAt } : entry,
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nota non salvata");
    } finally {
      setSaving("");
    }
  }
  async function addCash(kind: "withdrawal" | "exchange", input: { localAmount: string; euroAmount: string }) {
    if (!day) return false;
    const localAmount = numberValue(input.localAmount);
    const euroAmount = numberValue(input.euroAmount);
    if (!localAmount || !euroAmount) {
      setError("Inserisci importi validi per calcolare il cambio applicato.");
      return false;
    }
    setSaving("cash");
    setError("");
    try {
      const result = (await postJournal({
        action: "cash",
        dayId: day.id,
        kind,
        localAmount,
        euroAmount,
        localCurrency,
        feeEuro: null,
        clientOperationId: uuidV7(),
      })) as { movement: { id: string; createdAt: string } };
      setExperience((current) => ({
        ...current,
        cashMovements: [
          {
            id: result.movement.id,
            dayId: day.id,
            dayNumber: day.number,
            kind,
            euroAmount,
            localAmount,
            localCurrency,
            feeEuro: null,
            addedBy: userName,
            createdAt: result.movement.createdAt,
          },
          ...current.cashMovements,
        ],
      }));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Movimento non salvato");
      return false;
    } finally {
      setSaving("");
    }
  }
  async function deleteExpense(expenseId: string) {
    if (
      !(await confirmAction({
        title: "Elimina la spesa",
        message: "La spesa sarà rimossa definitivamente dalla cassa del gruppo.",
        confirmLabel: "Elimina spesa",
        tone: "danger",
      }))
    )
      return;
    const busyKey = `delete-expense-${expenseId}`;
    setSaving(busyKey);
    setError("");
    try {
      const response = await fetch("/api/traveler/expenses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departureId: experience.journey.departureId,
          partyId: experience.journey.partyId,
          expenseId,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Eliminazione della spesa non riuscita");
      setExperience((current) => ({
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== expenseId),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione della spesa non riuscita");
    } finally {
      setSaving("");
    }
  }
  async function deleteCashMovement(movementId: string, kind: "withdrawal" | "exchange") {
    if (
      !(await confirmAction({
        title: kind === "withdrawal" ? "Elimina il prelievo" : "Elimina il cambio",
        message: `${kind === "withdrawal" ? "Il prelievo" : "Il cambio"} sarà rimosso definitivamente dalla cassa del gruppo.`,
        confirmLabel: "Elimina movimento",
        tone: "danger",
      }))
    )
      return;
    const busyKey = `delete-cash-${movementId}`;
    setSaving(busyKey);
    setError("");
    try {
      const response = await fetch("/api/traveler/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departureId: experience.journey.departureId,
          partyId: experience.journey.partyId,
          movementId,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Eliminazione del movimento non riuscita");
      setExperience((current) => ({
        ...current,
        cashMovements: current.cashMovements.filter((movement) => movement.id !== movementId),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione del movimento non riuscita");
    } finally {
      setSaving("");
    }
  }
  async function saveExpense(input: { label: string; amount: string; currency: string; shareTravelerIds: string[] }) {
    const amount = numberValue(input.amount);
    if (!amount || amount <= 0) {
      setError("Inserisci un importo valido.");
      return false;
    }
    setSaving("expense");
    setError("");
    try {
      const exchangeRateToBase = input.currency === "EUR" ? 1 : appliedEurRate ? 1 / appliedEurRate : null;
      const operationId = uuidV7();
      const request = await resilientMutation({
        kind: "expense",
        url: "/api/traveler/expenses",
        method: "POST",
        body: {
          departureId: experience.journey.departureId,
          partyId: experience.journey.partyId,
          dayId: expenseDayId,
          label: input.label,
          amount,
          currency: input.currency,
          exchangeRateToBase,
          shareTravelerIds: input.shareTravelerIds,
          clientOperationId: operationId,
        },
      });
      const result = request.queued
        ? { id: operationId }
        : ((await request.response!.json()) as { id?: string; error?: string });
      if (!request.queued && (!request.response?.ok || !result.id))
        throw new Error(result.error || "Spesa non salvata");
      const expenseDay = experience.days.find((entry) => entry.id === expenseDayId);
      const baseAmount = exchangeRateToBase == null ? null : Math.round(amount * exchangeRateToBase * 10_000) / 10_000;
      const currentTraveler = experience.journey.travelers.find((traveler) => traveler.isCurrent);
      const shareBase = baseAmount == null ? 0 : baseAmount / input.shareTravelerIds.length;
      setExperience((current) => ({
        ...current,
        expenses: [
          {
            id: result.id!,
            dayId: expenseDayId || null,
            dayNumber: expenseDay?.number ?? null,
            label: input.label,
            amount,
            currency: input.currency,
            baseCurrency: "EUR",
            exchangeRateToBase,
            baseAmount,
            paidBy: userName,
            paidByTravelerId: currentTraveler?.id || "",
            shares: input.shareTravelerIds.map((travelerId) => ({
              travelerId,
              travelerName:
                experience.journey.travelers.find((traveler) => traveler.id === travelerId)?.name || "Viaggiatore",
              amount: amount / input.shareTravelerIds.length,
              baseAmount: shareBase,
            })),
            createdAt: new Date().toISOString(),
          },
          ...current.expenses,
        ],
      }));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spesa non salvata");
      return false;
    } finally {
      setSaving("");
    }
  }
  async function prepareOffline() {
    setOfflinePackage("downloading");
    setError("");
    try {
      const result = await downloadTripForOffline(offlineResourceUrls, (done, total) =>
        setOfflineProgress({ done, total }),
      );
      setOfflinePackage("ready");
      const cached = await Promise.all(
        travelDocuments.map(async (document) => {
          const request = new Request(new URL(document.downloadUrl, window.location.origin), {
            credentials: "include",
          });
          return (await caches.match(request)) ? document.id : null;
        }),
      );
      setOfflineDocumentIds(new Set(cached.filter((id): id is string => Boolean(id))));
      if (result.skipped > 0)
        setError(
          `Viaggio disponibile offline. ${result.skipped} ${result.skipped === 1 ? "allegato richiede" : "allegati richiedono"} la connessione.`,
        );
    } catch (caught) {
      setOfflinePackage("failed");
      setError(caught instanceof Error ? caught.message : "Download offline non riuscito");
    }
  }
  async function logout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual" });
      const registration = await navigator.serviceWorker?.ready;
      registration?.active?.postMessage({ type: "CLEAR_PRIVATE_CACHES" });
    } finally {
      window.location.replace("/login");
    }
  }
  async function openTravelDocument(event: MouseEvent<HTMLAnchorElement>, url: string, title: string) {
    if (navigator.onLine) return;
    event.preventDefault();
    setError("");
    try {
      const cached = await caches.match(new Request(new URL(url, window.location.origin), { credentials: "include" }));
      if (!cached) throw new Error("Documento non disponibile offline. Ricollegati e usa Scarica il viaggio.");
      const objectUrl = URL.createObjectURL(await cached.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = title;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Apertura del documento non riuscita");
    }
  }
  async function shareAlbum() {
    const url = `/api/traveler/travel-album?partenza=${encodeURIComponent(experience.journey.departureId)}`;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob(),
        file = new File([blob], "diario-del-viaggio.pdf", { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({ title: experience.journey.title, text: "Il diario del nostro viaggio", files: [file] });
      else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Condivisione del diario non riuscita. Riprova quando sei online.");
    }
  }
  function togglePreference(kind: "text" | "simple") {
    const key = kind === "text" ? "smf-large-text" : "smf-simple-mode";
    const currentValue = kind === "text" ? largeText : simpleMode;
    localStorage.setItem(key, currentValue ? "0" : "1");
    window.dispatchEvent(new Event(travelerPreferenceChangedEvent));
  }
  if (!day) return null;
  const currentDate = dateParts(day.date);
  const dayNote = experience.notes.find((entry) => entry.dayId === day.id);
  const agencyColor = accessibleBrandBackground(experience.journey.agencyBranding.primaryColor);
  const agencyRouteColor = accessibleBrandColor(experience.journey.agencyBranding.primaryColor);
  const agencyLogo = agencyLogoSource(experience.journey.agencyBranding.logoUrl, experience.journey.agencyId);
  const brandStyle = {
    "--agency-source": agencyColor,
    "--agency-primary": agencyColor,
    "--agency-on-primary": "#111111",
    "--smf-action": agencyColor,
    "--teal": agencyColor,
    "--on-brand": "#111111",
  } as CSSProperties;

  return (
    <>
      <main
        className={`travelExperience travelerRedesign${largeText ? " largeTextMode" : ""}${simpleMode ? " simpleMode" : ""}`}
        style={brandStyle}
        data-design-contract="b0beb44b"
        data-design-thesis="sentiero-delle-tappe"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          gestureStart.current = { x: touch.clientX, y: touch.clientY, atTop: window.scrollY <= 2 };
        }}
        onTouchEnd={(event) => {
          const start = gestureStart.current;
          const touch = event.changedTouches[0];
          gestureStart.current = null;
          if (!start) return;
          const dx = touch.clientX - start.x,
            dy = touch.clientY - start.y;
          if (start.atTop && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
            window.location.reload();
            return;
          }
          if (tab === "programma" && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4)
            selectDay(Math.max(0, Math.min(experience.days.length - 1, active + (dx < 0 ? 1 : -1))));
        }}
      >
        <title>{experience.journey.agencyName}</title>
        <link rel="icon" href="/api/pwa/icon?size=192" sizes="192x192" type="image/png" />
        <link rel="apple-touch-icon" href="/api/pwa/icon?size=192" sizes="192x192" />
        <meta name="apple-mobile-web-app-title" content={experience.journey.agencyName} />
        <link
          rel="apple-touch-startup-image"
          href="/splash/iphone-1170x2532.png"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash/iphone-1290x2796.png"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash/iphone-1242x2688.png"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"
        />
        <PwaCompanion />
        <a className="skipLink" href="#travel-main-content">
          Salta al contenuto del viaggio
        </a>
        <header className="topbar">
          <div className="brand">
            {agencyLogo ? (
              <img className="agencyLogo" src={agencyLogo} alt={`Logo ${experience.journey.agencyName}`} />
            ) : (
              <span className="brandMark">{initials(experience.journey.agencyName)}</span>
            )}
            <div>
              <strong>{experience.journey.agencyName}</strong>
              <small>POWERED BY SMF TRAVEL</small>
            </div>
          </div>
          <div className="tripDates">
            <CalendarDays />
            <span>
              {dateParts(experience.journey.startsOn).full} — {dateParts(experience.journey.endsOn).full}
            </span>
            <i>{experience.days.length} gg</i>
          </div>
          <div className="people">
            <span className={`connectionStatus ${isOnline ? "online" : "offline"}`} role="status" aria-live="polite">
              {isOnline ? <Wifi /> : <WifiOff />}
              <b>{isOnline ? (saving ? "Salvataggio…" : "Online") : "Solo consultazione"}</b>
            </span>
            <span className="currentUser">
              <i>{initials(userName)}</i>
              <b>{userName}</b>
            </span>
            <div className="avatars">
              {experience.journey.travelers.slice(0, 4).map((traveler) => (
                <i key={traveler.name}>{initials(traveler.name)}</i>
              ))}
            </div>
            {isAgencyAdmin && (
              <a className="agencyButton" href="/agenzia">
                <Building2 />
                <span>Agenzia</span>
              </a>
            )}
            <form className="logoutForm" action="/api/auth/logout" method="post" onSubmit={logout}>
              <button className="logoutButton" type="submit">
                <LogOut />
                <span>Esci</span>
              </button>
            </form>
          </div>
        </header>
        {experience.availableJourneys.length > 1 && (
          <nav className="journeyPicker" aria-label="Seleziona il viaggio">
            {experience.availableJourneys.map((journey) => (
              <a
                className={journey.departureId === experience.journey.departureId ? "active" : ""}
                href={`/viaggio?partenza=${journey.departureId}`}
                key={journey.departureId}
              >
                {journey.title}
                <small>{dateParts(journey.startsOn).full}</small>
              </a>
            ))}
          </nav>
        )}
        <section className="hero">
          <div className="heroTexture" aria-hidden="true" />
          <div className="heroCopy">
            <p className="eyebrow">IL NOSTRO VIAGGIO</p>
            <h1>{experience.journey.title}</h1>
            <p>
              {experience.journey.destinationCountry} · {experience.journey.partyName}
            </p>
          </div>
          <div className="routeSummary">
            <div>
              <strong>{experience.days.length}</strong>
              <span>GIORNI</span>
            </div>
            <div>
              <strong>{new Set(experience.days.flatMap((entry) => entry.cities.map((city) => city.name))).size}</strong>
              <span>LOCALITÀ</span>
            </div>
            <div>
              <strong>{experience.journey.travelers.length}</strong>
              <span>VIAGGIATORI</span>
            </div>
          </div>
        </section>
        <nav className="tabs" aria-label="Sezioni del viaggio">
          <button
            type="button"
            className={tab === "mappa" ? "active" : ""}
            aria-current={tab === "mappa" ? "page" : undefined}
            onClick={() => {
              selectTab("mappa");
              setMoreOpen(false);
            }}
          >
            <Map />
            <span>Mappa</span>
          </button>
          <button
            type="button"
            aria-label="Programma"
            className={tab === "programma" ? "active" : ""}
            aria-current={tab === "programma" ? "page" : undefined}
            onClick={() => {
              openProgramme();
              setMoreOpen(false);
            }}
          >
            <CalendarDays />
            <span className="desktopNavLabel">Programma</span>
            <span className="compactNavLabel" aria-hidden="true">
              Oggi
            </span>
          </button>
          <button
            type="button"
            aria-label="Documenti"
            className={tab === "documenti" ? "active" : ""}
            aria-current={tab === "documenti" ? "page" : undefined}
            onClick={() => {
              selectTab("documenti");
              setMoreOpen(false);
            }}
          >
            <FileText />
            <span className="desktopNavLabel">Documenti</span>
            <span className="compactNavLabel" aria-hidden="true">
              Doc.
            </span>
          </button>
          <button
            type="button"
            aria-label="Spese, prelievi e cambi"
            className={tab === "spese" ? "active" : ""}
            aria-current={tab === "spese" ? "page" : undefined}
            onClick={() => {
              selectTab("spese");
              setMoreOpen(false);
            }}
          >
            <Wallet />
            <span>Spese</span>
          </button>
          {experience.experienceProfile !== "essential" && (
            <button
              type="button"
              className={tab === "sfide" ? "active" : ""}
              aria-current={tab === "sfide" ? "page" : undefined}
              onClick={() => {
                selectTab("sfide");
                setMoreOpen(false);
              }}
            >
              <Sparkles />
              <span>Sfide</span>
            </button>
          )}
          <button
            ref={moreButtonRef}
            type="button"
            className={
              moreOpen || ["ricordi", "info", "frasario", "assicurazione", "valutazione"].includes(tab) ? "active" : ""
            }
            aria-expanded={moreOpen}
            aria-haspopup="true"
            aria-controls="travel-more-menu"
            onClick={() => setMoreOpen((value) => !value)}
          >
            <CircleUserRound />
            <span>Altro</span>
          </button>
        </nav>
        {moreOpen && (
          <div ref={moreMenuRef} id="travel-more-menu" className="moreMenu" role="region" aria-label="Altre sezioni">
            <div className="moreMenuHead">
              <strong>Altro</strong>
              <small>Informazioni e frasi di viaggio</small>
            </div>
            <button
              type="button"
              aria-current={tab === "assicurazione" ? "page" : undefined}
              onClick={() => {
                selectTab("assicurazione");
                setMoreOpen(false);
              }}
            >
              <ShieldAlert />
              <span>
                <strong>Assicurazione</strong>
                <small>Polizza e centrale operativa</small>
              </span>
              <ChevronRight />
            </button>
            {postTripReviewAvailable && (
              <button
                type="button"
                aria-current={tab === "valutazione" ? "page" : undefined}
                onClick={() => {
                  selectTab("valutazione");
                  setMoreOpen(false);
                }}
              >
                <Star />
                <span>
                  <strong>Valuta il viaggio</strong>
                  <small>Giudizio complessivo e passaparola</small>
                </span>
                <ChevronRight />
              </button>
            )}
            <button
              type="button"
              aria-current={tab === "info" ? "page" : undefined}
              onClick={() => {
                selectTab("info");
                setMoreOpen(false);
              }}
            >
              <Info />
              <span>
                <strong>Informazioni utili</strong>
                <small>Contatti, valuta e consigli</small>
              </span>
              <ChevronRight />
            </button>
            <button
              type="button"
              aria-current={tab === "frasario" ? "page" : undefined}
              onClick={() => {
                selectTab("frasario");
                setMoreOpen(false);
              }}
            >
              <Languages />
              <span>
                <strong>Frasi</strong>
                <small>Parole utili durante il viaggio</small>
              </span>
              <ChevronRight />
            </button>
            <button
              type="button"
              aria-current={tab === "chat" ? "page" : undefined}
              onClick={() => {
                selectTab("chat");
                setMoreOpen(false);
              }}
            >
              <MessageCircle />
              <span>
                <strong>Chat con l’agenzia</strong>
                <small>Domande e aggiornamenti operativi</small>
              </span>
              <ChevronRight />
            </button>
            <button
              type="button"
              aria-current={tab === "sos" ? "page" : undefined}
              onClick={() => {
                selectTab("sos");
                setMoreOpen(false);
              }}
            >
              <ShieldAlert />
              <span>
                <strong>SOS e assistenza</strong>
                <small>Contatti e posizione volontaria</small>
              </span>
              <ChevronRight />
            </button>
            <button type="button" aria-pressed={largeText} onClick={() => togglePreference("text")}>
              <Accessibility />
              <span>
                <strong>Testo grande</strong>
                <small>{largeText ? "Attivo" : "Aumenta la leggibilità"}</small>
              </span>
              <ChevronRight />
            </button>
            <button type="button" aria-pressed={simpleMode} onClick={() => togglePreference("simple")}>
              <Accessibility />
              <span>
                <strong>Modalità semplificata</strong>
                <small>{simpleMode ? "Attiva" : "Riduce gli elementi secondari"}</small>
              </span>
              <ChevronRight />
            </button>
          </div>
        )}
        <div id="travel-main-content" className="travelMainContent" ref={contentRef} tabIndex={-1}>
          <div className="srStatus" role="status" aria-live="polite" aria-atomic="true">
            {saving ? "Salvataggio in corso" : ""}
          </div>
          {error && (
            <p className="dataError" role="alert">
              {error}
            </p>
          )}
          {experience.changeNotices.some((notice) => !notice.readAt) && (
            <section className="travelerChangeNotices" aria-labelledby="change-notices-title">
              <header>
                <div>
                  <small>AGGIORNAMENTI DEL VIAGGIO</small>
                  <h2 id="change-notices-title">Cosa è cambiato</h2>
                </div>
                <span>{experience.changeNotices.filter((notice) => !notice.readAt).length} da leggere</span>
              </header>
              {experience.changeNotices
                .filter((notice) => !notice.readAt)
                .map((notice) => (
                  <article key={notice.id} className={`severity-${notice.severity}`}>
                    <div>
                      <small>
                        {new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(
                          new Date(notice.publishedAt),
                        )}
                      </small>
                      <strong>{notice.title}</strong>
                      <p>{notice.summary}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving === `notice-${notice.id}`}
                      onClick={() => void acknowledgeNotice(notice.id)}
                    >
                      {saving === `notice-${notice.id}` ? <LoaderCircle className="spin" /> : <Check />} Ho letto
                    </button>
                  </article>
                ))}
            </section>
          )}

          {tab === "mappa" && (
            <section className="overviewPage">
              <div className="overviewHead">
                <div>
                  <span>MAPPA DEL VIAGGIO</span>
                  <h2>Itinerario completo</h2>
                  <p>Tutte le città, le tappe e i pernottamenti disponibili lungo il viaggio.</p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(experience.journey.destinationCountry)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apri indicazioni <ExternalLink />
                </a>
              </div>
              {operationalPoints.length > 0 ? (
                <>
                  <div className="overviewMap">
                    <TripOverviewMap
                      days={operationalPoints}
                      routeColor={agencyRouteColor}
                      onSelect={() => undefined}
                    />
                  </div>
                  <div className="overviewDayList">
                    {operationalPoints.map((entry) => (
                      <a
                        key={`${entry.n}-${entry.lat}-${entry.lon}-${entry.title}`}
                        href={`https://www.google.com/maps/dir/?api=1&destination=${entry.lat},${entry.lon}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span style={{ background: entry.color }}>{entry.n}</span>
                        <span>
                          <small>
                            Giorno {entry.n} · {entry.city}
                          </small>
                          <strong>{entry.title}</strong>
                        </span>
                        <ExternalLink />
                      </a>
                    ))}
                  </div>
                  <p className="mapAttribution">
                    Le mappe già visualizzate restano disponibili offline per un periodo limitato.
                  </p>
                </>
              ) : (
                <div className="empty">
                  <Map />
                  <h3>Luoghi in preparazione</h3>
                  <p>Le coordinate dell’itinerario non sono ancora disponibili.</p>
                </div>
              )}
            </section>
          )}

          {tab === "programma" && (
            <div className="dashboard">
              <aside className="timeline">
                <div className="sectionTitle">
                  <div>
                    <span>ITINERARIO</span>
                    <h2>Giorno per giorno</h2>
                  </div>
                  <span>
                    {active + 1} / {experience.days.length}
                  </span>
                </div>
                <div className="dayList">
                  {experience.days.map((entry, index) => {
                    const date = dateParts(entry.date);
                    const Transport = dayTransport(entry).Icon;
                    return (
                      <button
                        key={entry.id}
                        className={`dayRow ${active === index ? "selected" : ""}`}
                        onClick={() => selectDay(index)}
                      >
                        <span className="dayDate">
                          <b>{date.day}</b>
                          {date.month}
                        </span>
                        <span className="line">
                          <i style={{ background: colors[index % colors.length] }} />
                        </span>
                        <span className="dayInfo">
                          <small>{entry.label || `GIORNO ${entry.number}`}</small>
                          <strong>{entry.city}</strong>
                          <em>
                            <Transport />
                            {entry.title}
                          </em>
                        </span>
                        <ChevronRight />
                      </button>
                    );
                  })}
                </div>
              </aside>
              <section className="detail">
                <div className="detailHead">
                  <div>
                    <span className="tag" style={{ color: colors[active % colors.length] }}>
                      {day.label || `GIORNO ${day.number}`} · {currentDate.full}
                    </span>
                    <h2>{day.title}</h2>
                    <p>
                      <MapPin />
                      <span className="cityLinks">
                        {day.cities.length
                          ? day.cities.map((city, index) => (
                              <Fragment key={city.id}>
                                {index > 0 && <ArrowRight />}
                                <a href={city.googleUrl} target="_blank" rel="noreferrer">
                                  {city.name}
                                  <ExternalLink />
                                </a>
                              </Fragment>
                            ))
                          : day.city}
                      </span>
                    </p>
                  </div>
                  <div className="pager">
                    <button
                      type="button"
                      aria-label="Giornata precedente"
                      disabled={active === 0}
                      onClick={() => selectDay(active - 1)}
                    >
                      <ArrowLeft />
                    </button>
                    <button
                      type="button"
                      aria-label="Giornata successiva"
                      disabled={active === experience.days.length - 1}
                      onClick={() => selectDay(active + 1)}
                    >
                      <ArrowRight />
                    </button>
                  </div>
                </div>
                <section className="dayContext dayContextOpen" aria-labelledby={`day-details-${day.id}`}>
                  <h3 id={`day-details-${day.id}`}>Dettagli della giornata</h3>
                  {day.description && <p className="description">{day.description}</p>}
                </section>
                <section className="dayProgramme">
                  <div className="dayProgrammeList">
                    {day.items.map((item, index) => {
                      const presentation = itemPresentation(item.type);
                      const ItemIcon = presentation.Icon;
                      const site = relatedSite(day, item);
                      const showTypeIcon = item.type !== "visit" && item.type !== "hotel";
                      const hasVisibleTime =
                        ["transport", "flight", "train"].includes(item.type) && Boolean(item.startsAt || item.endsAt);
                      const ratingBusy = saving === `rating-itinerary_item-${item.id}`;
                      return (
                        <article
                          className={`programmeStep type-${item.type} ${showTypeIcon ? "" : "withoutTypeIcon"}`}
                          key={item.id}
                        >
                          <span className="programmeStepNumber">{String(index + 1).padStart(2, "0")}</span>
                          <span className="programmeStepLine" />
                          {showTypeIcon && (
                            <span className="programmeStepIcon" aria-hidden="true">
                              <ItemIcon />
                            </span>
                          )}
                          <div className="programmeStepBody">
                            <div className="programmeStepMeta">
                              <small>{presentation.label}</small>
                              {hasVisibleTime && (
                                <time>
                                  <Clock3 />
                                  {item.startsAt || item.endsAt}
                                  {item.startsAt && item.endsAt ? ` – ${item.endsAt}` : ""}
                                </time>
                              )}
                            </div>
                            <h4>
                              {site ? (
                                <a href={site.googleUrl} target="_blank" rel="noreferrer">
                                  {item.title}
                                  <ExternalLink />
                                </a>
                              ) : (
                                item.title
                              )}
                            </h4>
                            {item.description && (
                              <div
                                className={
                                  item.type === "transport" ? "programmeOperationalNote" : "programmeDescriptionNote"
                                }
                              >
                                {item.type === "transport" && <strong>Note operative</strong>}
                                <p>{item.description}</p>
                              </div>
                            )}
                            {item.tickets.length > 0 && (
                              <div className="travelerTickets">
                                {item.tickets.map((ticket) => (
                                  <a href={ticket.downloadUrl} key={ticket.id}>
                                    <FileText />
                                    <span>
                                      <strong>Biglietto</strong>
                                      <small>{ticket.title}</small>
                                    </span>
                                    <Download />
                                  </a>
                                ))}
                              </div>
                            )}
                            <RatingStars
                              value={item.rating}
                              busy={ratingBusy}
                              label={`Valutazione di ${item.title}`}
                              onRate={(rating) => void saveRating(day.id, "itinerary_item", item.id, rating)}
                            />
                          </div>
                        </article>
                      );
                    })}
                    {day.hotels.map((hotel, hotelIndex) => {
                      const ratingBusy = saving === `rating-hotel-${hotel.id}`;
                      return (
                        <article className="programmeStep type-hotel" key={`hotel-${hotel.id}`}>
                          <span className="programmeStepNumber">
                            {String(day.items.length + hotelIndex + 1).padStart(2, "0")}
                          </span>
                          <span className="programmeStepLine" />
                          <div className="programmeStepBody">
                            <div className="programmeStepMeta">
                              <small>Pernottamento</small>
                            </div>
                            <h4>
                              <a href={hotel.googleUrl} target="_blank" rel="noreferrer">
                                {hotel.name}
                                <ExternalLink />
                              </a>
                            </h4>
                            <p>{hotel.city}</p>
                            <RatingStars
                              value={hotel.rating}
                              busy={ratingBusy}
                              label={`Valutazione di ${hotel.name}`}
                              onRate={(rating) => void saveRating(day.id, "hotel", hotel.id, rating)}
                            />
                          </div>
                        </article>
                      );
                    })}
                    {day.items.length === 0 && day.hotels.length === 0 && (
                      <div className="programmeEmpty">Programma dettagliato ancora da completare.</div>
                    )}
                  </div>
                </section>
                <div className="journal">
                  <div>
                    <MessageCircle />
                    <strong>Nota del giorno</strong>
                  </div>
                  <textarea
                    aria-label={`Nota del giorno ${day.number}`}
                    placeholder="Scrivi qui un ricordo, un consiglio, una curiosità…"
                    value={dayNote?.text || ""}
                    onChange={(event) =>
                      setExperience((current) => ({
                        ...current,
                        notes: current.notes.some((entry) => entry.dayId === day.id)
                          ? current.notes.map((entry) =>
                              entry.dayId === day.id
                                ? { ...entry, text: event.target.value, updatedBy: userName }
                                : entry,
                            )
                          : [
                              ...current.notes,
                              {
                                id: "new",
                                dayId: day.id,
                                dayNumber: day.number,
                                text: event.target.value,
                                updatedBy: userName,
                                updatedAt: "",
                              },
                            ],
                      }))
                    }
                    onBlur={() => void saveNote()}
                  />
                  {saving === `note-${day.id}` ? (
                    <small className="auditBy">Salvataggio…</small>
                  ) : (
                    dayNote?.text && <small className="auditBy">Ultima modifica: {dayNote.updatedBy}</small>
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === "ricordi" && (
            <section className="collection memoriesPage">
              <header className="memoriesHead">
                <div>
                  <Camera />
                  <span>
                    <small>RICORDI DEL VIAGGIO</small>
                    <h2>La nostra galleria</h2>
                    <p>Le foto condivise dal gruppo, ordinate per giornata.</p>
                  </span>
                </div>
                {experience.photos.length > 0 && (
                  <strong>
                    {experience.photos.length}
                    <small>{experience.photos.length === 1 ? "foto" : "foto"}</small>
                  </strong>
                )}
              </header>
              <div className="memoryAlbumActions">
                <a
                  href={`/api/traveler/travel-album?partenza=${encodeURIComponent(experience.journey.departureId)}`}
                  download
                >
                  <Download /> Scarica diario PDF
                </a>
                <button type="button" onClick={() => void shareAlbum()}>
                  <Share2 /> Condividi diario
                </button>
              </div>
              {experience.photos.length === 0 ? (
                <div className="empty memoriesEmpty">
                  <Camera />
                  <h3>La galleria aspetta il primo ricordo</h3>
                  <p>Le foto caricate nelle sfide e nei contest appariranno qui, disponibili per tutto il gruppo.</p>
                  <button type="button" onClick={() => selectTab("sfide")}>
                    Apri le sfide
                  </button>
                </div>
              ) : (
                <>
                  {memoryDays.length > 1 && (
                    <div className="memoryFilters" role="group" aria-label="Filtra le foto per giornata">
                      <button
                        type="button"
                        className={memoryDayFilter === "all" ? "active" : ""}
                        aria-pressed={memoryDayFilter === "all"}
                        onClick={() => setMemoryDayFilter("all")}
                      >
                        Tutte <span>{experience.photos.length}</span>
                      </button>
                      {memoryDays.map((dayNumber) => (
                        <button
                          type="button"
                          key={dayNumber}
                          className={memoryDayFilter === dayNumber ? "active" : ""}
                          aria-pressed={memoryDayFilter === dayNumber}
                          onClick={() => setMemoryDayFilter(dayNumber)}
                        >
                          Giorno {dayNumber} <span>{photosByDay[dayNumber].length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="memoryResult" role="status">
                    {visiblePhotos.length === 1 ? "1 foto visualizzata" : `${visiblePhotos.length} foto visualizzate`}
                  </p>
                  <div className="photoGrid">
                    {visiblePhotos.map((photo) => (
                      <figure key={photo.id}>
                        <img
                          src={photo.contentUrl}
                          alt={`Ricordo del giorno ${photo.dayNumber}: ${photo.originalName}`}
                          width={800}
                          height={600}
                          loading="lazy"
                          decoding="async"
                        />
                        <div className="photoActions">
                          <a
                            href={photo.downloadUrl}
                            download
                            aria-label={`Scarica ${photo.originalName}`}
                            title="Scarica foto"
                          >
                            <Download />
                          </a>
                        </div>
                        <figcaption>
                          <strong>Giorno {photo.dayNumber}</strong>
                          <span>{photo.addedBy}</span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {tab === "documenti" && (
            <section className="collection documentsPage">
              <header className="documentsHead">
                <div className="documentsTitle">
                  <Wallet />
                  <span>
                    <h2>Voucher, biglietti e documenti</h2>
                  </span>
                </div>
                <div className="offlinePackageAction">
                  <button
                    type="button"
                    disabled={offlinePackage === "downloading" || !isOnline}
                    onClick={() => void prepareOffline()}
                    aria-label={
                      offlinePackage === "downloading"
                        ? `Preparazione offline ${offlineProgress.done} di ${offlineProgress.total}`
                        : undefined
                    }
                  >
                    <Download />
                    {offlinePackage === "downloading"
                      ? "Preparazione offline…"
                      : offlinePackage === "ready"
                        ? "Aggiorna download"
                        : !isOnline
                          ? "Connettiti per scaricare"
                          : "Scarica documenti sul dispositivo"}
                  </button>
                  <small>Scarica i documenti per averli a disposizione anche offline.</small>
                </div>
              </header>
              {travelDocuments.length === 0 ? (
                <div className="empty documentsEmpty">
                  <FileText />
                  <h3>Nessun documento disponibile</h3>
                  <p>
                    L’agenzia non ha ancora allegato documenti per il tuo gruppo. Li troverai qui appena saranno
                    pubblicati.
                  </p>
                  <button type="button" onClick={() => selectTab("programma")}>
                    Torna al programma
                  </button>
                </div>
              ) : (
                <div className="documentList">
                  {travelDocuments.map((ticket) => {
                    const DocumentIcon = itemPresentation(ticket.itemType).Icon;
                    return (
                      <article key={ticket.id}>
                        <span className="documentIcon">
                          <DocumentIcon />
                        </span>
                        <span className="documentCopy">
                          <small>
                            GIORNO {ticket.dayNumber} · {dateParts(ticket.dayDate).full}
                          </small>
                          <strong>{ticket.title}</strong>
                          <p>
                            {ticket.itemTitle} · {ticket.dayTitle}
                          </p>
                          {offlineDocumentIds.has(ticket.id) && (
                            <em className="offlineDocumentBadge">Disponibile offline</em>
                          )}
                          {!offlineDocumentIds.has(ticket.id) && <em className="onlineDocumentBadge">Solo online</em>}
                        </span>
                        <a
                          href={ticket.downloadUrl}
                          download
                          aria-label={`Scarica ${ticket.title}`}
                          onClick={(event) => {
                            trackAnalytics("document_download", { documentId: ticket.id, dayNumber: ticket.dayNumber });
                            void openTravelDocument(event, ticket.downloadUrl, ticket.title);
                          }}
                        >
                          <Download />
                          <span>Scarica</span>
                        </a>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {tab === "spese" && (
            <section className="collection expensesPage">
              <div className="expenseHero">
                <span>SPESE, PRELIEVI E CAMBI</span>
                <div className="expenseCurrencyTotals">
                  <div>
                    <small>EURO</small>
                    <strong>€ {totals.EUR.toFixed(2)}</strong>
                  </div>
                  <div>
                    <small>VALUTA LOCALE</small>
                    <strong>
                      {localFormatter.format(totals.local)} {localCurrency}
                    </strong>
                  </div>
                  <div className="grandTotal">
                    <small>TOTALE SPESO IN EURO</small>
                    <strong>{totalSpentEuro == null ? "Calcolo…" : `€ ${totalSpentEuro.toFixed(2)}`}</strong>
                  </div>
                </div>
                <section className="expenseExchangeHighlight" aria-label="Cambio valuta">
                  <span>
                    <ArrowRightLeft /> Cambio valuta
                  </span>
                  <strong>
                    {appliedEurRate
                      ? `1 € = ${localFormatter.format(appliedEurRate)} ${localCurrency}`
                      : "Cambio non disponibile"}
                  </strong>
                  <small>Valuta di riferimento per il gruppo {experience.journey.partyName}</small>
                </section>
              </div>
              <div className="financeActions">
                <button type="button" onClick={() => setExpenseDayId(null)}>
                  <ReceiptText />
                  <span>
                    Nuova spesa<small>Spesa del gruppo</small>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={saving === "cash" || !hasValidatedLocalCurrency}
                  onClick={() => setCashDialogKind("withdrawal")}
                >
                  <Banknote />
                  <span>
                    Nuovo prelievo
                    <small>Giorno {day.number}</small>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={saving === "cash" || !hasValidatedLocalCurrency}
                  onClick={() => setCashDialogKind("exchange")}
                >
                  <ArrowRightLeft />
                  <span>
                    Nuovo cambio
                    <small>Registra il cambio valuta</small>
                  </span>
                </button>
              </div>
              <header className="financeSectionHeading">
                <span>SPESE DEL GRUPPO</span>
                <h2>Spese</h2>
              </header>
              {experience.expenses.length === 0 ? (
                <p className="cashEmpty financeEmptyCompact">Nessuna spesa registrata.</p>
              ) : (
                <div className="expenseList">
                  {experience.expenses.map((expense) => (
                    <div key={expense.id}>
                      <span className="receipt">
                        <ReceiptText />
                      </span>
                      <span>
                        <strong>{expense.label}</strong>
                        <small>
                          Pagato da {expense.paidBy}
                          {expense.dayNumber ? ` · Giorno ${expense.dayNumber}` : ""}
                        </small>
                      </span>
                      <b>
                        {expense.currency === "EUR"
                          ? `€ ${expense.amount.toFixed(2)}`
                          : `${wholeNumber.format(expense.amount)} ${expense.currency}`}
                      </b>
                      <button
                        className="financeDelete"
                        type="button"
                        disabled={saving === `delete-expense-${expense.id}`}
                        onClick={() => void deleteExpense(expense.id)}
                        aria-label={`Elimina la spesa ${expense.label}`}
                        title="Elimina spesa"
                      >
                        {saving === `delete-expense-${expense.id}` ? <LoaderCircle className="spin" /> : <Trash2 />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="cashSection">
                <div className="sectionTitle">
                  <div>
                    <span>GESTIONE CONTANTI</span>
                    <h2>Prelievi e cambi</h2>
                  </div>
                </div>
                {experience.cashMovements.length === 0 ? (
                  <p className="cashEmpty">Nessun prelievo o cambio registrato.</p>
                ) : (
                  <div className="cashMovementList">
                    {experience.cashMovements.map((movement) => (
                      <div key={movement.id}>
                        <span className={`cashIcon ${movement.kind}`}>
                          <Banknote />
                        </span>
                        <span>
                          <strong>{movement.kind === "withdrawal" ? "Prelievo ATM" : "Cambio valuta"}</strong>
                          <small>
                            Giorno {movement.dayNumber} · Inserito da {movement.addedBy}
                          </small>
                          <em className="appliedExchangeRate">
                            {exchangeRateLabel(movement.euroAmount, movement.localAmount, movement.localCurrency)}
                          </em>
                        </span>
                        <b>
                          {movement.euroAmount != null && <small>€ {movement.euroAmount.toFixed(2)}</small>}
                          {wholeNumber.format(movement.localAmount)} {movement.localCurrency}
                        </b>
                        <button
                          className="financeDelete"
                          type="button"
                          disabled={saving === `delete-cash-${movement.id}`}
                          onClick={() =>
                            void deleteCashMovement(
                              movement.id,
                              movement.kind === "withdrawal" ? "withdrawal" : "exchange",
                            )
                          }
                          aria-label={`Elimina ${movement.kind === "withdrawal" ? "il prelievo" : "il cambio"}`}
                          title={movement.kind === "withdrawal" ? "Elimina prelievo" : "Elimina cambio"}
                        >
                          {saving === `delete-cash-${movement.id}` ? <LoaderCircle className="spin" /> : <Trash2 />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "info" && (
            <section className="usefulPage">
              <header className="usefulHero">
                <span>PRONTI A PARTIRE</span>
                <h2>Informazioni utili</h2>
                <p>
                  Contatti e consigli pratici sempre a portata di mano. Verifica i requisiti sensibili prima della
                  partenza.
                </p>
              </header>
              <div className="worldClockBar">
                <article>
                  <small>ITALIA</small>
                  <strong>{formatClock("Europe/Rome", now)}</strong>
                  <span>Ora italiana</span>
                </article>
                <div>
                  <ArrowRightLeft />
                  <span>
                    1 € = {appliedEurRate ? localFormatter.format(appliedEurRate) : "…"} {localCurrency}
                  </span>
                </div>
                <article>
                  <small>{experience.journey.destinationCountry.toUpperCase()}</small>
                  <strong>{formatClock(localTimeZone, now)}</strong>
                  <span>Ora locale</span>
                </article>
              </div>
              <section className="infoSection">
                <div className="infoSectionHead">
                  <Info />
                  <div>
                    <small>{experience.journey.destinationCountry}</small>
                    <h3>Tutto ciò che serve sapere</h3>
                  </div>
                </div>
                <div className="cultureGrid">
                  {displayedUsefulInfo.map((item, index) => (
                    <article key={`${item.title}-${index}`}>
                      <Info />
                      <h4>{item.title}</h4>
                      <p>{item.body}</p>
                      {item.phone && !/(ambasciat|salute)/i.test(item.title) && (
                        <a href={`tel:${item.phone}`}>{item.phone}</a>
                      )}
                      <footer className="usefulGovernance">
                        <span className={`review-${item.reviewStatus}`}>
                          {item.reviewStatus === "approved" ? "Verificato" : "Da verificare"}
                        </span>
                        {item.verifiedAt && (
                          <time>
                            Verificato il {new Intl.DateTimeFormat("it-IT").format(new Date(item.verifiedAt))}
                          </time>
                        )}
                        {item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                            Fonte: {item.sourceName || "sito ufficiale"}
                            <ExternalLink />
                          </a>
                        )}
                        {item.disclaimer && <small>{item.disclaimer}</small>}
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          )}
          {tab === "assicurazione" && (
            <section className="insurancePage">
              <header className="insuranceHero">
                <ShieldAlert />
                <span>
                  <small>ASSISTENZA IN VIAGGIO</small>
                  <h2>Polizza assicurativa</h2>
                  <p>I riferimenti ufficiali inseriti dall’agenzia per questa partenza.</p>
                </span>
              </header>
              {experience.insurance ? (
                <>
                  <article className="insuranceEmergency">
                    <span>
                      <small>CENTRALE OPERATIVA</small>
                      <h3>{experience.insurance.providerName}</h3>
                      {experience.insurance.productName && <p>{experience.insurance.productName}</p>}
                    </span>
                    <a className="insuranceCall" href={`tel:${experience.insurance.assistancePhone}`}>
                      <Phone />
                      <span>
                        <small>Chiama</small>
                        <strong>{experience.insurance.assistancePhone}</strong>
                      </span>
                    </a>
                  </article>
                  <div className="insuranceSummary">
                    <article>
                      <small>NUMERO POLIZZA</small>
                      <strong>{experience.insurance.policyNumber}</strong>
                    </article>
                    <article>
                      <small>VALIDITÀ</small>
                      <strong>
                        {new Intl.DateTimeFormat("it-IT").format(
                          new Date(`${experience.insurance.validFrom}T12:00:00`),
                        )}{" "}
                        –{" "}
                        {new Intl.DateTimeFormat("it-IT").format(new Date(`${experience.insurance.validTo}T12:00:00`))}
                      </strong>
                    </article>
                  </div>
                  {experience.insurance.guarantees.length > 0 && (
                    <section className="insuranceSection">
                      <div className="insuranceSectionHead">
                        <ShieldAlert />
                        <div>
                          <small>COPERTURE</small>
                          <h3>Garanzie indicate</h3>
                        </div>
                      </div>
                      <div className="insuranceChecklist">
                        {experience.insurance.guarantees.map((entry, index) => {
                          const guarantee = entry as { label?: string; status?: string; notes?: string };
                          return (
                            <article key={`${guarantee.label}-${index}`}>
                              <strong>{guarantee.label}</strong>
                              <span>
                                {guarantee.status === "included"
                                  ? "Inclusa"
                                  : guarantee.status === "excluded"
                                    ? "Esclusa"
                                    : "Non indicata"}
                              </span>
                              {guarantee.notes && <small>{guarantee.notes}</small>}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  {experience.insurance.documentId && (
                    <a
                      className="insuranceDocumentDownload"
                      href={`/api/travel-documents/${experience.insurance.documentId}/content?download=1`}
                    >
                      <Download /> Scarica il documento della polizza
                    </a>
                  )}
                </>
              ) : (
                <p className="cashEmpty insuranceEmpty">Polizza non disponibile.</p>
              )}
            </section>
          )}
          {tab === "frasario" && (
            <section className="phrasebookPage">
              <header className="phrasebookHero">
                <span>
                  <Languages />
                </span>
                <div>
                  <small>PAROLE UTILI</small>
                  <h2>Frasario da viaggio</h2>
                  <p>Le parole giuste per salutare, ordinare, spostarsi e chiedere aiuto.</p>
                </div>
              </header>
              <div className="languageNote">
                Pronuncia semplificata e traduzione italiana, preparate per{" "}
                <strong>{experience.journey.destinationCountry}</strong>.
              </div>
              <div className="phraseList">
                {experience.phrases.map((phrase, index) => (
                  <article key={`${phrase.term}-${index}`}>
                    <span className="phraseCategory">{phrase.category}</span>
                    <h3>{phrase.translation}</h3>
                    <div className="phraseTranslations">
                      <div>
                        <small>{phrase.language}</small>
                        <strong>{phrase.term}</strong>
                        <em>{phrase.pronunciation}</em>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {tab === "sos" && (
            <section className="collection sosPage">
              <header>
                <ShieldAlert />
                <div>
                  <small>ASSISTENZA IN VIAGGIO</small>
                  <h2>SOS e contatti utili</h2>
                  <p>
                    Consulta le istruzioni e contatta subito i servizi competenti. SMF Travel non condivide né conserva
                    la tua posizione.
                  </p>
                </div>
              </header>
              <div className="sosActions">
                {emergencyInfo?.phone ? (
                  <a href={`tel:${emergencyInfo.phone}`}>
                    <Phone />
                    <span>
                      <strong>Chiama emergenze</strong>
                      <small>{emergencyInfo.phone}</small>
                    </span>
                  </a>
                ) : (
                  <div className="sosUnavailable">
                    <Phone />
                    <span>
                      <strong>Numero locale da verificare</strong>
                      <small>Consulta le informazioni ufficiali prima di chiamare</small>
                    </span>
                  </div>
                )}
                <button type="button" onClick={() => selectTab("chat")}>
                  <MessageCircle />
                  <span>
                    <strong>Contatta l’agenzia</strong>
                    <small>Apri la chat operativa del gruppo</small>
                  </span>
                </button>
              </div>
              <div className="sosGuidance">
                <h3>Prima di agire</h3>
                <ol>
                  <li>Se sei in pericolo immediato, chiama il numero di emergenza locale.</li>
                  <li>Comunica nome, luogo e cosa è successo.</li>
                  <li>Avvisa il capogruppo o l’agenzia appena possibile.</li>
                </ol>
              </div>
              <OperationalAlertForm
                departureId={experience.journey.departureId}
                travelers={experience.journey.travelers}
              />
            </section>
          )}
          {tab === "spese" && experience.expenses.length > 0 && (
            <section className="collection expenseBalances" aria-labelledby="expense-balances-title">
              <div>
                <small>PAREGGIO DEL GRUPPO</small>
                <h2 id="expense-balances-title">Saldo per viaggiatore</h2>
                <p>Valori positivi: deve ricevere. Valori negativi: deve versare.</p>
              </div>
              <div>
                {expenseBalances.map((traveler) => (
                  <article key={traveler.id}>
                    <span>{initials(traveler.name)}</span>
                    <strong>{traveler.name}</strong>
                    <b className={traveler.balance >= 0 ? "credit" : "debit"}>
                      {traveler.balance >= 0 ? "+" : "−"} € {Math.abs(traveler.balance).toFixed(2)}
                    </b>
                  </article>
                ))}
              </div>
            </section>
          )}
          {tab === "chat" && (
            <section className="travelerChatScopes">
              <div
                role="tablist"
                aria-label="Conversazioni"
                onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const scopes = ["trip", "group", "traveler"] as const;
                  const currentIndex = scopes.indexOf(chatScope);
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? scopes.length - 1
                        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + scopes.length) % scopes.length;
                  const nextScope = scopes[nextIndex];
                  setChatScope(nextScope);
                  document.getElementById(`chat-tab-${nextScope}`)?.focus();
                }}
              >
                {(["trip", "group", "traveler"] as const).map((scope) => (
                  <button
                    id={`chat-tab-${scope}`}
                    key={scope}
                    type="button"
                    role="tab"
                    aria-selected={chatScope === scope}
                    aria-controls="chat-conversation-panel"
                    tabIndex={chatScope === scope ? 0 : -1}
                    onClick={() => setChatScope(scope)}
                  >
                    {scope === "trip" ? "Viaggio" : scope === "group" ? "Gruppo" : "Personale"}
                  </button>
                ))}
              </div>
              <div id="chat-conversation-panel" role="tabpanel" aria-labelledby={`chat-tab-${chatScope}`} tabIndex={0}>
                <OperationalChat
                  departureId={experience.journey.departureId}
                  partyId={chatScope === "trip" ? undefined : experience.journey.partyId}
                  travelerId={
                    chatScope === "traveler"
                      ? experience.journey.travelers.find((traveler) => traveler.isCurrent)?.id
                      : undefined
                  }
                  scope={chatScope}
                />
              </div>
            </section>
          )}
          {tab === "sfide" && (
            <PlatformTripChallenges
              experience={experience}
              userName={userName}
              isAdmin={isAgencyAdmin}
              onResultsChange={(challengeResults) => setExperience((current) => ({ ...current, challengeResults }))}
            />
          )}
          {tab === "valutazione" && (
            <PostTripReview
              departureId={experience.journey.departureId}
              partyId={experience.journey.partyId}
              onOpenChat={() => {
                setChatScope("traveler");
                selectTab("chat");
              }}
            />
          )}
        </div>
        {expenseDayId !== undefined && (
          <ExpenseDialog
            key={expenseDayId}
            open
            dayLabel={expenseDayId ? currentDate.full : undefined}
            localCurrency={localCurrency}
            travelers={experience.journey.travelers.map(({ id, name }) => ({ id, name }))}
            saving={saving === "expense"}
            onClose={() => setExpenseDayId(undefined)}
            onSave={saveExpense}
          />
        )}
        {cashDialogKind && (
          <CashMovementDialog
            key={cashDialogKind}
            kind={cashDialogKind}
            dayLabel={String(day.number)}
            localCurrency={localCurrency}
            saving={saving === "cash"}
            onClose={() => setCashDialogKind(null)}
            onSave={(input) => addCash(cashDialogKind, input)}
          />
        )}
      </main>
      {confirmDialog}
    </>
  );
}
