"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Camera, ChevronRight, CloudSun, Compass, ExternalLink,
  Hotel, MapPin, Navigation, ReceiptText, Share2, Sparkles, Wallet
} from "lucide-react";
import { selectedTripDay } from "@/lib/today-data";
import PwaInstaller from "./pwa-installer";

type DaySummary = {
  n: number;
  label?: string;
  date: string;
  city: string;
  title: string;
  description: string;
  lat: number;
  lon: number;
  hotel: string | string[];
  service?: string;
};

type Expense = { day: number | null; amount: number; currency: "EUR" | "UZS" };
type Weather = { available: boolean; code?: number; min?: number | null; max?: number | null; rain?: number | null };

function weatherLabel(code = 0) {
  if (code === 0) return "Sereno";
  if (code <= 3) return "Poco nuvoloso";
  if (code <= 48) return "Nebbia";
  if (code <= 67) return "Possibile pioggia";
  if (code <= 77) return "Neve";
  if (code <= 82) return "Rovesci";
  return "Temporali";
}

function countdownLabel(timestamp?: string) {
  if (!timestamp) return "Orario da confermare";
  const difference = new Date(timestamp).getTime() - Date.now();
  if (difference <= 0) return "In programma";
  const hours = Math.floor(difference / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Tra ${days} ${days === 1 ? "giorno" : "giorni"}`;
  if (hours > 0) return `Tra ${hours} ${hours === 1 ? "ora" : "ore"}`;
  return `Tra ${Math.max(1, Math.ceil(difference / 60_000))} min`;
}

export default function TodayDashboard({
  days,
  expenses,
  photos,
  onOpenDay,
  onOpenChallenges
}: {
  days: DaySummary[];
  expenses: Expense[];
  photos: Record<number, Array<unknown>>;
  onOpenDay: (day: number) => void;
  onOpenChallenges: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const detail = useMemo(() => selectedTripDay(now), [now]);
  const day = days.find((entry) => entry.n === detail.day) ?? days[0];
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWeather(null);
    fetch(`/api/weather?lat=${day.lat}&lon=${day.lon}&date=${detail.isoDate}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<Weather>)
      .then((payload) => { if (!cancelled) setWeather(payload); })
      .catch(() => { if (!cancelled) setWeather({ available: false }); });
    return () => { cancelled = true; };
  }, [day.lat, day.lon, detail.isoDate]);

  const nextEvent = useMemo(() => {
    const timed = detail.schedule
      .filter((entry) => entry.timestamp && new Date(entry.timestamp).getTime() > now.getTime());
    return timed[0]
      ?? detail.schedule.find((entry) => !entry.timestamp)
      ?? detail.schedule[detail.schedule.length - 1];
  }, [detail.schedule, now]);
  const totals = expenses.reduce((sum, expense) => {
    if (expense.day === day.n) sum[expense.currency] += expense.amount;
    return sum;
  }, { EUR: 0, UZS: 0 });
  const hotel = Array.isArray(day.hotel) ? day.hotel[day.hotel.length - 1] : day.hotel;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${day.lat},${day.lon}`;

  async function shareMeetingPoint() {
    const share = {
      title: `Uzbekistan · ${day.date}`,
      text: `${detail.meetingPoint} — ${day.city}`,
      url: mapsUrl
    };
    if (navigator.share) {
      await navigator.share(share).catch(() => null);
    } else {
      await navigator.clipboard?.writeText(`${share.text}\n${share.url}`).catch(() => null);
    }
  }

  return (
    <section className="todayPage">
      <div className="todayHero">
        <div>
          <span>{day.label ?? `GIORNO ${day.n}`} · {day.date}</span>
          <h2>{day.title}</h2>
          <p>{day.city}</p>
        </div>
        <div className="todayHeroDay"><small>OGGI</small><strong>{day.date.split(" ")[0]}</strong><span>AGO</span></div>
      </div>

      <section className="nextAppointment">
        <span><CalendarClock size={24}/></span>
        <div><small>PROSSIMO APPUNTAMENTO · {countdownLabel(nextEvent?.timestamp)}</small><h3>{nextEvent?.label ?? "Giornata libera"}</h3><p>{nextEvent?.time} · {detail.meetingPoint}</p></div>
        <button type="button" onClick={() => onOpenDay(day.n)} aria-label="Apri il programma della giornata"><ChevronRight size={21}/></button>
      </section>

      <div className="todayInfoGrid">
        <article>
          <span><CloudSun size={22}/></span>
          <small>METEO</small>
          {weather?.available
            ? <><strong>{Math.round(weather.max ?? 0)}° / {Math.round(weather.min ?? 0)}°</strong><p>{weatherLabel(weather.code)} · pioggia {weather.rain ?? 0}%</p></>
            : <><strong>Da aggiornare</strong><p>Disponibile fino a 16 giorni prima</p></>
          }
        </article>
        <article>
          <span><Hotel size={22}/></span>
          <small>HOTEL</small>
          <strong>{hotel}</strong>
          <p>{day.service}</p>
        </article>
        <article>
          <span><Wallet size={22}/></span>
          <small>SPESE DI TAPPA</small>
          <strong>€ {totals.EUR.toFixed(2)}</strong>
          <p>{new Intl.NumberFormat("it-IT").format(totals.UZS)} UZS</p>
        </article>
        <article>
          <span><Camera size={22}/></span>
          <small>RICORDI</small>
          <strong>{photos[day.n]?.length ?? 0} foto</strong>
          <p>caricate per questa giornata</p>
        </article>
      </div>

      <div className="todayActions">
        <a href={mapsUrl} target="_blank" rel="noreferrer"><Navigation size={19}/><span>Portami lì<small>Apri Google Maps</small></span><ExternalLink size={15}/></a>
        <button type="button" onClick={() => void shareMeetingPoint()}><Share2 size={19}/><span>Condividi ritrovo<small>{detail.meetingPoint}</small></span><ChevronRight size={15}/></button>
        <button type="button" onClick={onOpenChallenges}><Sparkles size={19}/><span>Sfide del giorno<small>Missioni, Bingo e giochi</small></span><ChevronRight size={15}/></button>
      </div>

      <PwaInstaller/>

      <section className="todaySchedule">
        <div><Compass size={20}/><span><small>PROGRAMMA RAPIDO</small><h3>La giornata in un colpo d’occhio</h3></span></div>
        {detail.schedule.map((item) => (
          <article key={`${item.time}-${item.label}`}><time>{item.time}</time><span/><strong>{item.label}</strong></article>
        ))}
        <button type="button" onClick={() => onOpenDay(day.n)}><ReceiptText size={17}/> Apri tutti i dettagli</button>
      </section>
      <p className="weatherCredit">Previsioni meteo: Open-Meteo.</p>
    </section>
  );
}
