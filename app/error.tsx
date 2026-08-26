"use client";

import { CircleAlert, House, RotateCcw } from "lucide-react";
import "./system-status.css";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="systemStatusPage">
      <section className="systemStatusPanel" role="alert">
        <span className="systemStatusMark isError" aria-hidden="true"><CircleAlert/></span>
        <h1>Questa pagina non si è caricata</h1>
        <p>I tuoi dati non sono stati modificati. Controlla la connessione e prova nuovamente.</p>
        <div className="systemStatusActions">
          <button className="primary" type="button" onClick={reset}><RotateCcw/>Riprova</button>
          <a href="/"><House/>Torna alla pagina iniziale</a>
        </div>
      </section>
    </main>
  );
}
