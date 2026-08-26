import { Navigation } from "lucide-react";
import "./system-status.css";

export default function Loading() {
  return (
    <main className="systemStatusPage" aria-busy="true" aria-live="polite">
      <section className="systemStatusPanel">
        <span className="systemStatusMark" aria-hidden="true"><Navigation/></span>
        <h1>Prepariamo il tuo spazio</h1>
        <p>Stiamo recuperando le informazioni aggiornate del viaggio.</p>
        <div className="systemLoadingTrack" aria-hidden="true"/>
      </section>
    </main>
  );
}
