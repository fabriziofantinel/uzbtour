import Link from "next/link";
import { Building2, MapPinned, Plus, UsersRound } from "lucide-react";
import { getSuperadminSummary } from "@/lib/platform/superadmin-repository";

export default async function SuperadminHome() {
  const summary = await getSuperadminSummary();
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

      <section className="superadminQuick">
        <div><small>GESTIONE</small><h2>Amministra le agenzie</h2><p>Inserisci i dati anagrafici e assegna gli agenti autorizzati.</p></div>
        <Link href="/admin/agenzie">Apri elenco agenzie <Building2 size={18}/></Link>
      </section>
    </div>
  );
}
