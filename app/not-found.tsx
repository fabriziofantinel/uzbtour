import { House, MapPinned } from "lucide-react";
import "./system-status.css";

export default function NotFound() {
  return (
    <main className="systemStatusPage">
      <section className="systemStatusPanel">
        <span className="systemStatusMark" aria-hidden="true"><MapPinned/></span>
        <h1>Questa destinazione non esiste</h1>
        <p>Il collegamento potrebbe essere cambiato oppure non essere disponibile per il tuo profilo.</p>
        <div className="systemStatusActions">
          <a className="primary" href="/"><House/>Torna alla pagina iniziale</a>
        </div>
      </section>
    </main>
  );
}
