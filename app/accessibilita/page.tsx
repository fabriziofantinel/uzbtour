import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Keyboard,
  MessageSquareText,
  MousePointer2,
  ScanText,
  Smartphone,
  Volume2,
} from "lucide-react";
import "./accessibilita.css";

export const metadata: Metadata = {
  title: "Accessibilità e assistenza | SMF Travel",
  description: "Impegno, strumenti e modalità di segnalazione per l’accessibilità di SMF Travel.",
};

const measures = [
  { Icon: Keyboard, title: "Tastiera", text: "Navigazione, comandi e finestre di dialogo utilizzabili senza mouse." },
  {
    Icon: Eye,
    title: "Contrasto e zoom",
    text: "Focus sempre visibile, contrasto rinforzato e contenuti adattabili all’ingrandimento.",
  },
  {
    Icon: Volume2,
    title: "Tecnologie assistive",
    text: "Titoli, regioni, etichette e messaggi dinamici descritti semanticamente.",
  },
  {
    Icon: Smartphone,
    title: "Uso da smartphone",
    text: "Controlli tattili ampi e pagine che si riordinano senza perdere informazioni.",
  },
];

export default function AccessibilityPage() {
  return (
    <main id="main-content" className="accessibilityPage">
      <a className="agidSkipLink" href="#accessibility-content">
        Salta alle informazioni sull’accessibilità
      </a>
      <header className="accessibilityTopbar">
        <Link href="/">
          <ArrowLeft aria-hidden="true" /> Torna a SMF Travel
        </Link>
        <span>
          <i>SMF</i>
          <strong>Travel</strong>
        </span>
      </header>

      <div id="accessibility-content" className="accessibilityShell" tabIndex={-1}>
        <section className="accessibilityHero">
          <span aria-hidden="true">
            <ScanText />
          </span>
          <div>
            <p>ACCESSIBILITÀ E ASSISTENZA</p>
            <h1>Un viaggio digitale accessibile a più persone.</h1>
            <p>
              SMF Travel è progettata seguendo i principi WCAG di percepibilità, utilizzabilità, comprensibilità e
              robustezza, con particolare attenzione all’uso in mobilità.
            </p>
          </div>
        </section>

        <section aria-labelledby="measures-title" className="accessibilitySection">
          <div className="accessibilitySectionHead">
            <h2 id="measures-title">Cosa abbiamo predisposto</h2>
            <p>Le misure sono integrate nell’interfaccia e non richiedono un widget separato.</p>
          </div>
          <div className="accessibilityMeasures">
            {measures.map(({ Icon, title, text }) => (
              <article key={title}>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="segnalazione" aria-labelledby="report-title" className="accessibilityReport">
          <span aria-hidden="true">
            <MessageSquareText />
          </span>
          <div>
            <h2 id="report-title">Hai incontrato una barriera?</h2>
            <p>
              Segnalala alla tua agenzia indicando pagina, operazione, dispositivo e tecnologia assistiva utilizzata. Se
              possibile, allega una schermata: aiuterà a riprodurre e correggere il problema.
            </p>
            <p className="accessibilityStatus">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Stato del servizio:</strong> verifica tecnica continua. Questa pagina descrive l’impegno del
                prodotto e non costituisce una certificazione legale.
              </span>
            </p>
          </div>
        </section>

        <section aria-labelledby="tips-title" className="accessibilityTips">
          <div>
            <MousePointer2 aria-hidden="true" />
            <h2 id="tips-title">Strumenti del browser</h2>
          </div>
          <ul>
            <li>Usa lo zoom del browser per ingrandire testo e controlli.</li>
            <li>
              Premi <kbd>Tab</kbd> per spostarti tra i comandi e <kbd>Invio</kbd> o <kbd>Spazio</kbd> per attivarli.
            </li>
            <li>
              Le preferenze di contrasto elevato e movimento ridotto del dispositivo vengono rispettate automaticamente.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
