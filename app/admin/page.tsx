import Link from "next/link";
import { ArrowRight, Building2, LogIn, MapPinned, Plus, UsersRound } from "lucide-react";
import { getSuperadminSummary } from "@/lib/platform/superadmin-repository";
import { requireSuperAdmin } from "@/lib/platform/authorization";

export default async function SuperadminHome() {
  const actor = await requireSuperAdmin();
  const summary = await getSuperadminSummary(actor.id);
  const tripsPerAgency = summary.agencies ? summary.trips / summary.agencies : 0;
  const travelersPerTrip = summary.trips ? summary.travelers / summary.trips : 0;
  return (
    <div className="superadminShell">
      <section className="superadminHero">
        <div><small>CONTROLLO PIATTAFORMA</small><h1>Riepilogo generale</h1><p>Una vista unica su tutte le realtà gestite da SMF Travel.</p></div>
        <Link href="/admin/agenzie"><Plus size={17}/> Nuova agenzia</Link>
      </section>

      <section className="superadminStats" aria-label="Statistiche piattaforma">
        <article><span><Building2/></span><div><small>AGENZIE</small><strong>{summary.agencies}</strong><p>Tenant censiti nella piattaforma</p></div></article>
        <article><span><MapPinned/></span><div><small>VIAGGI</small><strong>{summary.trips}</strong><p>Programmi presenti nel catalogo</p></div></article>
        <article><span><UsersRound/></span><div><small>VIAGGIATORI</small><strong>{summary.travelers}</strong><p>Profili associati alle famiglie</p></div></article>
      </section>

      <section className="superadminOperations">
        <div className="superadminOperationsHead"><h2>Operazioni principali</h2><p>Gestisci organizzazioni e verifica l’esperienza con i permessi reali degli utenti.</p></div>
        <div className="superadminOperationLinks">
          <Link href="/admin/agenzie"><Building2/><span><strong>Agenzie e agenti</strong><small>Anagrafiche, identità visiva e utenti dell’agenzia</small></span><ArrowRight/></Link>
          <Link href="/admin/utenti"><LogIn/><span><strong>Login come utente</strong><small>Apri una sessione con gli stessi ruoli del profilo scelto</small></span><ArrowRight/></Link>
        </div>
        <aside className="superadminRatios" aria-label="Indicatori medi della piattaforma">
          <h3>Indicatori medi</h3>
          <div><span><b>{tripsPerAgency.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</b><small>viaggi per agenzia</small></span><MapPinned/></div>
          <div><span><b>{travelersPerTrip.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</b><small>viaggiatori per viaggio</small></span><UsersRound/></div>
        </aside>
      </section>
    </div>
  );
}
