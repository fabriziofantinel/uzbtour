"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, Banknote, Building2, CircleHelp, CloudSun,
  Droplets, ExternalLink, HeartPulse, Landmark, MapPin, Phone, Plane,
  Plug, ShieldCheck, Shirt, Smartphone, Stethoscope, Utensils, Wifi
} from "lucide-react";

const FALLBACK_RATE = 13663.77;
const somFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const euroFormatter = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseNumber(value: string) {
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return Number.NaN;
  if (compact.includes(",")) return Number(compact.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ""));
  return Number(compact);
}

function CallCard({ number, label, detail }: { number: string; label: string; detail: string }) {
  return (
    <a className="emergencyCard" href={`tel:${number.replace(/\s/g, "")}`}>
      <span><Phone size={18}/></span>
      <strong>{number}</strong>
      <small>{label}</small>
      <em>{detail}</em>
    </a>
  );
}

export default function UsefulInfo() {
  const [rateText, setRateText] = useState(String(FALLBACK_RATE));
  const [rateDate, setRateDate] = useState("");
  const [rateLive, setRateLive] = useState(false);
  const [euro, setEuro] = useState("100");
  const [som, setSom] = useState(String(Math.round(100 * FALLBACK_RATE)));

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/exchange-rate", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Rate unavailable");
        return response.json() as Promise<{ rate: number; date: string }>;
      })
      .then((data) => {
        setRateText(String(data.rate));
        setRateDate(data.date);
        setRateLive(true);
        setSom(String(Math.round(100 * data.rate)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setRateLive(false);
      });

    return () => controller.abort();
  }, []);

  function updateEuro(value: string) {
    setEuro(value);
    const amount = parseNumber(value);
    const rate = parseNumber(rateText);
    if (Number.isFinite(amount) && Number.isFinite(rate) && rate > 0) {
      setSom(String(Math.round(amount * rate)));
    } else if (!value) {
      setSom("");
    }
  }

  function updateSom(value: string) {
    setSom(value);
    const amount = parseNumber(value);
    const rate = parseNumber(rateText);
    if (Number.isFinite(amount) && Number.isFinite(rate) && rate > 0) {
      setEuro((amount / rate).toFixed(2));
    } else if (!value) {
      setEuro("");
    }
  }

  function updateRate(value: string) {
    setRateText(value);
    setRateLive(false);
    const rate = parseNumber(value);
    const euroAmount = parseNumber(euro);
    if (Number.isFinite(rate) && rate > 0 && Number.isFinite(euroAmount)) {
      setSom(String(Math.round(euroAmount * rate)));
    }
  }

  const parsedRate = parseNumber(rateText);

  return (
    <section className="usefulPage">
      <header className="usefulHero">
        <span>PRONTI A PARTIRE</span>
        <h2>Informazioni utili</h2>
        <p>Contatti, conversioni e consigli pratici sempre a portata di mano.</p>
      </header>

      <section className="converterCard" aria-labelledby="converter-title">
        <div className="converterHead">
          <span><Banknote size={21}/></span>
          <div>
            <small>CAMBIO VALUTA</small>
            <h3 id="converter-title">Convertitore euro - SOM</h3>
          </div>
          <b className={rateLive ? "live" : ""}>{rateLive ? "TASSO UFFICIALE" : "TASSO MANUALE"}</b>
        </div>
        <div className="converterFields">
          <label>
            <span>Euro</span>
            <div><b>€</b><input inputMode="decimal" value={euro} onChange={(event) => updateEuro(event.target.value)} aria-label="Importo in euro"/></div>
          </label>
          <ArrowRightLeft size={20}/>
          <label>
            <span>Som uzbeki</span>
            <div><b>UZS</b><input inputMode="numeric" value={som} onChange={(event) => updateSom(event.target.value)} aria-label="Importo in som uzbeki"/></div>
          </label>
        </div>
        <div className="rateEditor">
          <label>Tasso: 1 € = <input inputMode="decimal" value={rateText} onChange={(event) => updateRate(event.target.value)} aria-label="Tasso euro som"/> UZS</label>
          <small>
            {Number.isFinite(parsedRate) && parsedRate > 0 && <>100 € = {somFormatter.format(parsedRate * 100)} UZS · 100.000 UZS = € {euroFormatter.format(100000 / parsedRate)}. </>}
            {rateDate && <>Aggiornato al {rateDate}. </>}
            Il cambio effettivo può includere commissioni.
          </small>
          <a href="https://cbu.uz/en/arkhiv-kursov-valyut/" target="_blank" rel="noreferrer">Fonte: Banca Centrale dell’Uzbekistan <ExternalLink size={12}/></a>
        </div>
      </section>

      <section className="infoSection emergencySection">
        <div className="infoSectionHead"><ShieldCheck size={22}/><div><small>IN CASO DI NECESSITÀ</small><h3>Numeri di emergenza</h3></div></div>
        <div className="emergencyGrid">
          <CallCard number="112" label="Emergenza unica" detail="Coordinamento di tutti i servizi"/>
          <CallCard number="103" label="Ambulanza" detail="Emergenza sanitaria"/>
          <CallCard number="102" label="Polizia" detail="Call center di emergenza"/>
          <CallCard number="101" label="Vigili del fuoco" detail="Incendi e soccorso"/>
          <CallCard number="1173" label="Hotline turistica 24/7" detail="In inglese, uzbeko e russo"/>
        </div>
        <a className="sourceLink" href="https://ambtashkent.esteri.it/it/chi-siamo/numeri-di-emergenza/" target="_blank" rel="noreferrer">Fonte ufficiale: Ambasciata d’Italia a Tashkent <ExternalLink size={12}/></a>
      </section>

      <div className="infoColumns">
        <section className="infoCard consularCard">
          <div className="infoCardTitle"><Landmark size={20}/><h3>Ambasciata e Unità di Crisi</h3></div>
          <a className="bigContact" href="tel:+998908081369"><small>EMERGENZE CONSOLARI IN UZBEKISTAN</small><strong>+998 90 808 13 69</strong></a>
          <a className="bigContact" href="tel:+390636225"><small>UNITÀ DI CRISI MAECI · H24</small><strong>+39 06 36225</strong></a>
          <ul>
            <li>Centralino: <a href="tel:+998712031120">+998 71 203 11 20</a></li>
            <li>Ufficio consolare: <a href="tel:+998712031098">+998 71 203 10 98</a></li>
            <li><a href="mailto:consolare.tashkent@esteri.it">consolare.tashkent@esteri.it</a></li>
            <li>40 Yusuf Xos Xodjib Street, Tashkent</li>
          </ul>
          <p className="warningNote"><AlertTriangle size={16}/><span>Dal 2 marzo 2026 l’accesso alla sede è sospeso fino a nuove disposizioni: contattare prima l’Ambasciata.</span></p>
          <a className="sourceLink" href="https://ambtashkent.esteri.it/it/chi-siamo/contatti/" target="_blank" rel="noreferrer">Contatti aggiornati <ExternalLink size={12}/></a>
        </section>

        <section className="infoCard">
          <div className="infoCardTitle"><CircleHelp size={20}/><h3>Assistenza del tour</h3></div>
          <a className="bigContact whatsapp" href="https://wa.me/393475218989" target="_blank" rel="noreferrer"><small>COORDINATRICE SILVIA · WHATSAPP H24</small><strong>+39 347 521 89 89</strong></a>
          <ul>
            <li>Golden Terra Travel: <a href="tel:+998337078780">+998 33 707 87 80</a></li>
            <li>Cellulare locale: <a href="tel:+998977181870">+998 97 718 18 70</a></li>
            <li><a href="mailto:info@goldenterratravel.com">info@goldenterratravel.com</a></li>
            <li>General Manager locale: Shukhrat, aggiunto alla chat prima della partenza.</li>
          </ul>
          <p>La chat condivide programma definitivo, orari, hotel confermati e raccomandazioni operative.</p>
        </section>
      </div>

      <section className="infoSection">
        <div className="infoSectionHead"><Stethoscope size={22}/><div><small>SALUTE E ASSISTENZA</small><h3>Sanità e strutture mediche</h3></div></div>
        <div className="medicalGrid">
          <div><HeartPulse size={19}/><span><strong>Prima scelta: 103</strong><small>Chiamare l’ambulanza e avvisare subito l’assicurazione.</small></span></div>
          <div><Building2 size={19}/><span><strong>Tashkent International Clinic</strong><small>+998 71 291 01 42 · personale anche in inglese.</small></span></div>
          <div><Building2 size={19}/><span><strong>Emergenze mediche Bukhara</strong><small>+998 66 225 22 92 · centro pubblico.</small></span></div>
          <div><Building2 size={19}/><span><strong>Clinica medica di Samarcanda</strong><small>+998 66 238 67 26 · russo e uzbeko.</small></span></div>
        </div>
        <p className="infoDisclaimer">Elenco informativo, non una raccomandazione medica. Verificare con assicurazione, assistenza locale o Ambasciata prima di recarsi in struttura.</p>
        <a className="sourceLink" href="https://www.gov.uk/government/publications/uzbekistan-list-of-medical-facilitiespractitioners/uzbekistan-medical-facilities" target="_blank" rel="noreferrer">Elenco istituzionale aggiornato delle strutture <ExternalLink size={12}/></a>
      </section>

      <div className="tipsGrid">
        <section className="tipCard">
          <div className="infoCardTitle"><ShieldCheck size={20}/><h3>Documenti e sicurezza</h3></div>
          <ul>
            <li>Passaporto con almeno 3 mesi di validità residua.</li>
            <li>Il programma indica visto non richiesto per cittadini italiani.</li>
            <li>Conservare una copia dei documenti separata dagli originali.</li>
            <li>Registrare il viaggio su “Dove siamo nel mondo”.</li>
            <li>Verificare le regole prima della partenza su Viaggiare Sicuri.</li>
          </ul>
          <div className="inlineLinks">
            <a href="https://www.viaggiaresicuri.it/find-country/country/UZB" target="_blank" rel="noreferrer">Viaggiare Sicuri <ExternalLink size={11}/></a>
            <a href="https://www.dovesiamonelmondo.it/home.html" target="_blank" rel="noreferrer">Dove siamo nel mondo <ExternalLink size={11}/></a>
          </div>
        </section>

        <section className="tipCard">
          <div className="infoCardTitle"><CloudSun size={20}/><h3>Caldo e abbigliamento</h3></div>
          <ul>
            <li>Ad agosto le temperature possono superare i 40 °C.</li>
            <li>Portare crema solare, cappellino e ombrellino da viaggio.</li>
            <li>Preferire visite a piedi al mattino o nel tardo pomeriggio.</li>
            <li><Shirt size={14}/> Nei luoghi sacri: spalle e ginocchia coperte, scarpe facili da sfilare; foulard consigliato.</li>
          </ul>
        </section>

        <section className="tipCard">
          <div className="infoCardTitle"><Droplets size={20}/><h3>Salute e alimentazione</h3></div>
          <ul>
            <li>Polizza sanitaria con rimpatrio fortemente consigliata.</li>
            <li>Portare farmaci personali e bere solo acqua sigillata.</li>
            <li>La gestione degli allergeni non segue standard internazionali: possibili contaminazioni.</li>
            <li><Utensils size={14}/> Cena generalmente 19:00-20:00, con servizio rapido.</li>
          </ul>
        </section>

        <section className="tipCard">
          <div className="infoCardTitle"><Banknote size={20}/><h3>Moneta e mance</h3></div>
          <ul>
            <li>Valuta locale: som uzbeko (UZS).</li>
            <li>Portare euro contanti; cambio assistito dalla guida il primo giorno.</li>
            <li>Carte meno diffuse fuori da hotel e ristoranti.</li>
            <li>Mance indicative: 5-10 € al giorno alla guida, 3-5 € all’autista.</li>
          </ul>
        </section>

        <section className="tipCard">
          <div className="infoCardTitle"><Wifi size={20}/><h3>Telefono e corrente</h3></div>
          <ul>
            <li><Smartphone size={14}/> Wi-Fi negli hotel e nei principali locali.</li>
            <li>SIM locale da acquistare con la guida, evitando l’aeroporto; alternativa eSIM.</li>
            <li>Prefisso Uzbekistan: +998 · Italia: +39.</li>
            <li><Plug size={14}/> Prese di tipo C, bipolari e senza messa a terra.</li>
            <li>Fuso orario: +3 ore con l’ora legale italiana.</li>
          </ul>
        </section>

        <section className="tipCard">
          <div className="infoCardTitle"><Plane size={20}/><h3>Altri promemoria</h3></div>
          <ul>
            <li>Presentarsi in aeroporto almeno 3 ore prima.</li>
            <li>Droni vietati; animali domestici non ammessi.</li>
            <li>Prestare attenzione ai tombini lungo le strade.</li>
            <li>In hotel esporre “Please make up room” per richiedere il riordino.</li>
            <li>Se arrivano odori dagli scarichi, far scorrere l’acqua e avvisare la reception se persistono.</li>
          </ul>
        </section>
      </div>

      <p className="programmeSource"><MapPin size={14}/> Indicazioni pratiche tratte dal programma Golden Terra Travel e dal cronoprogramma allegato; contatti di emergenza verificati il 28 luglio 2026.</p>
    </section>
  );
}
