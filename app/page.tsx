"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Bus, CalendarDays, Camera, ChevronRight,
  CircleUserRound, Clock3, ExternalLink, LogOut, Map, MapPin, MessageCircle,
  Navigation, Plane, Plus, ReceiptText, TrainFront, Utensils, Wallet
} from "lucide-react";

type Day = {
  n: number; date: string; city: string; title: string; type: "plane" | "train" | "bus" | "walk";
  from?: string; to?: string; duration?: string; description: string; activities: string[];
  color: string; lat: number; lon: number; hotel: string; service?: string;
};

type SessionUser = { id: string; name: string; initials: string };
type NoteEntry = { text: string; updatedBy: string };
type PhotoEntry = { url: string; addedBy: string };

const days: Day[] = [
  { n: 1, date: "2 AGO", city: "Tashkent → Khiva", title: "La capitale e il volo verso Urgench", type: "plane", from: "Tashkent", to: "Urgench / Khiva", duration: "20:40 · arrivo da confermare", description: "Partenza il 1 agosto da Torino con TK1310, coincidenza a Istanbul sul TK370 e arrivo a Tashkent alle 00:50 del 2 agosto. Accoglienza e riposo, poi visite dalle 10:30/11:00. In serata volo interno per Urgench e trasferimento di circa 40 km a Khiva.", activities: ["Complesso Khast Imam", "Madrasa Barak Khan", "Bazaar Chorsu", "Metropolitana di Tashkent", "Piazza dell’Indipendenza"], color: "#D6663D", lat: 41.2995, lon: 69.2401, hotel: "Zarafshon, Khiva", service: "Guida privata in italiano · cena inclusa" },
  { n: 2, date: "3 AGO", city: "Khiva", title: "La città-museo di Ichan Kala", type: "walk", description: "Visita guidata di mezza giornata nel cuore murato di Khiva. Al termine delle visite, tempo libero e cena in ristorante locale.", activities: ["Ichan Kala", "Kalta Minor", "Kunya Ark", "Madrasa Muhammad Amin Khan", "Moschea Juma", "Palazzo Tosh Hovli"], color: "#715C9D", lat: 41.3784, lon: 60.3605, hotel: "Zarafshon, Khiva", service: "Guida privata in italiano · cena inclusa" },
  { n: 3, date: "4 AGO", city: "Bukhara", title: "Nel deserto sulla Via della Seta", type: "bus", from: "Khiva", to: "Bukhara", duration: "480 km · 6/7 ore", description: "Partenza in veicolo privato attraverso il deserto con soste tecniche. Arrivo nel pomeriggio e passeggiata orientativa nel centro storico.", activities: ["Deserto del Kyzylkum", "Centro storico di Bukhara"], color: "#C4902F", lat: 39.7681, lon: 64.4556, hotel: "Shaxriston, Bukhara", service: "Autista privato · cena inclusa" },
  { n: 4, date: "5 AGO", city: "Bukhara", title: "La città santa dell’Asia Centrale", type: "walk", description: "Giornata di visita guidata tra fortezze, mausolei, moschee e gli antichi mercati coperti.", activities: ["Mausoleo dei Samanidi", "Fortezza Ark", "Moschea Bolo Hauz", "Complesso Poi Kalon", "Mercati coperti di Bukhara", "Chor Minor"], color: "#C4902F", lat: 39.7758, lon: 64.4149, hotel: "Shaxriston, Bukhara", service: "Guida privata in italiano · cena inclusa" },
  { n: 5, date: "6 AGO", city: "Samarcanda", title: "Dal palazzo dell’emiro al Registan", type: "train", from: "Bukhara", to: "Samarcanda", duration: "15:03–16:48", description: "Check-out e visita al palazzo estivo dell’ultimo emiro. Treno per Samarcanda e, dopo cena, Registan illuminato.", activities: ["Sitorai Mokhi Khosa", "Piazza Registan di sera"], color: "#177A78", lat: 39.6542, lon: 66.9597, hotel: "Maridian Plaza, Samarcanda", service: "Trasferimenti privati · cena inclusa" },
  { n: 6, date: "7 AGO", city: "Samarcanda", title: "Le meraviglie di Tamerlano", type: "walk", description: "Intera giornata guidata tra le architetture più celebri della città, seguita da cena in ristorante locale.", activities: ["Mausoleo Gur-e-Amir", "Piazza Registan", "Moschea Bibi Khanum", "Bazaar Siab"], color: "#177A78", lat: 39.6548, lon: 66.9758, hotel: "Maridian Plaza, Samarcanda", service: "Guida privata in italiano · cena inclusa" },
  { n: 7, date: "8 AGO", city: "Shahrisabz", title: "La città verde di Amir Temur", type: "bus", from: "Samarcanda", to: "Shahrisabz e ritorno", duration: "Escursione giornaliera", description: "Escursione nella città natale di Amir Temur. Visita delle rovine monumentali e dei complessi funerari, quindi rientro a Samarcanda.", activities: ["Palazzo Ak-Saray", "Dorus-Saodat", "Dorut-Tilovat", "Moschea Kok-Gumbaz"], color: "#3D8B68", lat: 39.0578, lon: 66.8342, hotel: "Maridian Plaza, Samarcanda", service: "Guida privata · cena inclusa" },
  { n: 8, date: "9 AGO", city: "Samarcanda → Tashkent", title: "Necropoli, astronomia e carta", type: "train", from: "Samarcanda", to: "Tashkent", duration: "17:40–20:07", description: "Ultimi approfondimenti culturali a Samarcanda. Nel tardo pomeriggio treno per Tashkent, trasferimento in hotel e cena.", activities: ["Necropoli Shah-i-Zinda", "Osservatorio di Ulugh Beg", "Fabbrica della carta di Konigil"], color: "#177A78", lat: 39.674, lon: 66.987, hotel: "Inspira-S, Tashkent", service: "Guida privata · treno · cena inclusa" },
  { n: 9, date: "10 AGO", city: "Kokand → Fergana", title: "Ceramiche e palazzi nella Valle di Fergana", type: "train", from: "Tashkent", to: "Kokand", duration: "08:10–12:29", description: "Treno senza guida verso la Valle di Fergana. Incontro con l’autista locale, visita di Kokand e del villaggio dei ceramisti di Rishtan; proseguimento per Fergana.", activities: ["Palazzo Khudoyar Khan", "Moschea del venerdì di Kokand", "Ceramiche di Rishtan"], color: "#A35D55", lat: 40.5286, lon: 70.9425, hotel: "Saroy Garden, Fergana", service: "Autista privato · senza guida" },
  { n: 10, date: "11 AGO", city: "Margilan → Tashkent", title: "La seta della Valle di Fergana", type: "bus", from: "Fergana", to: "Tashkent", duration: "Trasferimento su strada", description: "Partenza con autista per Margilan. Visita alla produzione tradizionale della seta e al bazar della frutta; rientro a Tashkent con sosta panoramica in montagna.", activities: ["Fabbrica della seta di Margilan", "Bazar di Margilan", "Passo montano Kamchik"], color: "#A35D55", lat: 40.4711, lon: 71.7247, hotel: "Inspira-S, Tashkent", service: "Autista privato · senza guida · cena inclusa" },
  { n: 11, date: "12 AGO", city: "Tashkent", title: "Ultime visite e partenza", type: "plane", from: "Tashkent", to: "Istanbul / Torino", duration: "TK363 + TK1309", description: "Colazione e tempo libero. Camera fino alle 12:00; late check-out fino alle 18:00 su richiesta. Cena di arrivederci, trasferimento in aeroporto e rientro via Istanbul con i voli TK363 e TK1309.", activities: ["Tempo libero a Tashkent", "Ultimi acquisti", "Cena di arrivederci"], color: "#D6663D", lat: 41.2995, lon: 69.2401, hotel: "Check-out da Inspira-S", service: "Trasferimento aeroporto · cena inclusa" }
];

const icons = { plane: Plane, train: TrainFront, bus: Bus, walk: Navigation };

const internationalFlights = [
  {
    direction: "ANDATA",
    date: "1 AGOSTO",
    route: "Torino → Istanbul → Tashkent",
    airports: "TRN · IST · TAS",
    legs: [
      { number: "TK1310", from: "Torino", to: "Istanbul" },
      { number: "TK370", from: "Istanbul", to: "Tashkent" }
    ]
  },
  {
    direction: "RITORNO",
    date: "12 AGOSTO",
    route: "Tashkent → Istanbul → Torino",
    airports: "TAS · IST · TRN",
    legs: [
      { number: "TK363", from: "Tashkent", to: "Istanbul" },
      { number: "TK1309", from: "Istanbul", to: "Torino" }
    ]
  }
];

export default function Home() {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<"programma" | "ricordi" | "spese">("programma");
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [notes, setNotes] = useState<Record<number, NoteEntry>>({});
  const [restaurants, setRestaurants] = useState<{ day: number; name: string; addedBy: string }[]>([
    { day: 1, name: "Caravan — cucina uzbeka", addedBy: "Fabrizio" }
  ]);
  const [expenses, setExpenses] = useState([
    { label: "Treno Afrosiyob", amount: 48, payer: "Fabrizio" },
    { label: "Cena Caravan", amount: 72, payer: "Partecipante 2" },
    { label: "Ingressi Registan", amount: 36, payer: "Partecipante 3" }
  ]);
  const [photos, setPhotos] = useState<Record<number, PhotoEntry[]>>({});
  const day = days[active];
  const Icon = icons[day.type];
  const total = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((result: { user?: SessionUser }) => setCurrentUser(result.user ?? null));
  }, []);

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!currentUser) return;
    const files = Array.from(e.target.files ?? []);
    const addedBy = currentUser.name;
    setPhotos(p => ({
      ...p,
      [day.n]: [...(p[day.n] ?? []), ...files.map((file) => ({ url: URL.createObjectURL(file), addedBy }))]
    }));
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandMark">UZ</span><div><strong>Via della Seta</strong><small>UZBEKISTAN · 2026</small></div></div>
        <div className="tripDates"><CalendarDays size={17}/><span>1 — 12 agosto</span><i>11 gg tour</i></div>
        <div className="people">
          {currentUser && <span className="currentUser"><i>{currentUser.initials}</i><b>{currentUser.name}</b></span>}
          <div className="avatars"><i>FF</i><i>P2</i><i>P3</i></div>
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
          <h1>Undici giorni sulla<br/><em>Via della Seta</em></h1>
          <p>Quattro città, infinite storie e un diario tutto nostro.</p>
        </div>
        <div className="routeSummary">
          <div><strong>2.000+</strong><span>KM DA PERCORRERE</span></div>
          <div><strong>8</strong><span>LOCALITÀ</span></div>
          <div><strong>3</strong><span>VIAGGIATORI</span></div>
        </div>
      </section>

      <section className="flightStrip" aria-label="Voli internazionali">
        <div className="flightStripTitle">
          <span className="flightIcon"><Plane size={19}/></span>
          <div><small>VOLI INTERNAZIONALI</small><strong>Turkish Airlines</strong></div>
        </div>
        {internationalFlights.map((flight) => (
          <article className="flightCard" key={flight.direction}>
            <div className="flightMeta"><b>{flight.direction}</b><span>{flight.date}</span></div>
            <div className="flightRoute">
              <strong>{flight.route}</strong>
              <small>{flight.airports}</small>
            </div>
            <div className="flightLegs">
              {flight.legs.map((leg) => (
                <span key={leg.number}>
                  <b>{leg.number}</b>
                  <small>{leg.from} → {leg.to}</small>
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <nav className="tabs">
        <button className={tab === "programma" ? "active" : ""} onClick={() => setTab("programma")}><Map size={18}/> Programma</button>
        <button className={tab === "ricordi" ? "active" : ""} onClick={() => setTab("ricordi")}><Camera size={18}/> Ricordi <b>{Object.values(photos).flat().length}</b></button>
        <button className={tab === "spese" ? "active" : ""} onClick={() => setTab("spese")}><Wallet size={18}/> Spese <b>€ {total}</b></button>
      </nav>

      {tab === "programma" && <div className="dashboard">
        <aside className="timeline">
          <div className="sectionTitle"><div><span>ITINERARIO</span><h2>Giorno per giorno</h2></div><span>{active + 1} / 11</span></div>
          <div className="dayList">
            {days.map((d, i) => {
              const DIcon = icons[d.type];
              return <button key={d.n} className={`dayRow ${active === i ? "selected" : ""}`} onClick={() => setActive(i)}>
                <span className="dayDate"><b>{d.date.split(" ")[0]}</b>{d.date.split(" ")[1]}</span>
                <span className="line"><i style={{background:d.color}}></i></span>
                <span className="dayInfo"><small>GIORNO {d.n}</small><strong>{d.city}</strong><em><DIcon size={13}/>{d.title}</em></span>
                <ChevronRight size={17}/>
              </button>
            })}
          </div>
        </aside>

        <section className="detail">
          <div className="detailHead">
            <div><span className="tag" style={{color:day.color}}>GIORNO {day.n} · {day.date}</span><h2>{day.title}</h2><p><MapPin size={16}/>{day.city}, Uzbekistan</p></div>
            <div className="pager"><button disabled={active===0} onClick={()=>setActive(active-1)}><ArrowLeft size={17}/></button><button disabled={active===10} onClick={()=>setActive(active+1)}><ArrowRight size={17}/></button></div>
          </div>
          {day.from && <div className="transfer">
            <span className="transport"><Icon size={21}/></span>
            <div><small>TRASFERIMENTO</small><strong>{day.from} <ArrowRight size={15}/> {day.to}</strong></div>
            <span><Clock3 size={15}/>{day.duration}</span>
          </div>}
          <p className="description">{day.description}</p>
          <div className="stayInfo">
            <span><CircleUserRound size={16}/>{day.service}</span>
            <span><MapPin size={16}/><strong>{day.hotel}</strong></span>
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
              disabled={!currentUser}
              onChange={e => setNotes({
                ...notes,
                [day.n]: { text: e.target.value, updatedBy: currentUser!.name }
              })}
            />
            {notes[day.n]?.text && <small className="auditBy">Ultima modifica: {notes[day.n].updatedBy}</small>}
          </div>
          <div className="quickActions">
            <label className={!currentUser ? "disabled" : ""}><Camera size={18}/><span>Aggiungi foto<small>{photos[day.n]?.length ?? 0} caricate</small></span><Plus size={17}/><input type="file" accept="image/*" multiple disabled={!currentUser} onChange={upload}/></label>
            <button disabled={!currentUser} onClick={()=>{const name=prompt("Nome del locale?"); if(name&&currentUser)setRestaurants([...restaurants,{day:day.n,name,addedBy:currentUser.name}])}}><Utensils size={18}/><span>Aggiungi locale<small>{restaurants.filter(r=>r.day===day.n).length} salvati</small></span><Plus size={17}/></button>
            <button disabled={!currentUser} onClick={()=>{const label=prompt("Descrizione spesa?"); const amount=Number(prompt("Importo in euro?")); if(label&&amount&&currentUser)setExpenses([...expenses,{label,amount,payer:currentUser.name}])}}><ReceiptText size={18}/><span>Aggiungi spesa<small>Totale € {total}</small></span><Plus size={17}/></button>
          </div>
          {restaurants.filter((restaurant) => restaurant.day === day.n).length > 0 && (
            <div className="restaurantList">
              {restaurants.filter((restaurant) => restaurant.day === day.n).map((restaurant, index) => (
                <span key={`${restaurant.name}-${index}`}>
                  <Utensils size={13}/><b>{restaurant.name}</b><small>Aggiunto da {restaurant.addedBy}</small>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>}

      {tab === "ricordi" && <section className="collection">
        <div className="sectionTitle"><div><span>DIARIO VISIVO</span><h2>I nostri ricordi</h2></div></div>
        {Object.values(photos).flat().length === 0 ? <div className="empty"><Camera size={36}/><h3>La galleria aspetta il primo ricordo</h3><p>Apri una giornata del programma e aggiungi le tue foto.</p><button onClick={()=>setTab("programma")}>Vai al programma</button></div> :
        <div className="photoGrid">{Object.entries(photos).flatMap(([d,entries])=>entries.map(photo=><figure key={photo.url}><img src={photo.url} alt="Ricordo del viaggio"/><figcaption>Giorno {d} · {photo.addedBy}</figcaption></figure>))}</div>}
      </section>}

      {tab === "spese" && <section className="collection expensesPage">
        <div className="expenseHero"><span>SPESE DEL GRUPPO</span><h2>€ {total.toFixed(2)}</h2><p>€ {(total/3).toFixed(2)} a persona</p></div>
        <div className="expenseList">{expenses.map((e,i)=><div key={i}><span className="receipt"><ReceiptText size={18}/></span><span><strong>{e.label}</strong><small>Pagato da {e.payer}</small></span><b>€ {e.amount.toFixed(2)}</b></div>)}</div>
        <button className="primary" disabled={!currentUser} onClick={()=>{const label=prompt("Descrizione spesa?"); const amount=Number(prompt("Importo in euro?")); if(label&&amount&&currentUser)setExpenses([...expenses,{label,amount,payer:currentUser.name}])}}><Plus size={17}/> Nuova spesa</button>
      </section>}
    </main>
  );
}
