import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowRight, Building2, LogIn, MapPinned, Plus, UsersRound } from "lucide-react";
import { getSuperadminSummary } from "@/lib/platform/superadmin-repository";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { readCountryProfilesForReview, reviewCountryProfile } from "@/lib/platform/country-profile-admin";

async function reviewCountryProfileAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdmin();
  const countryId = String(formData.get("countryId") || "");
  const decision = String(formData.get("decision") || "");
  if (!/^[0-9a-f-]{36}$/i.test(countryId) || !["approve", "reject"].includes(decision)) return;
  await reviewCountryProfile(actor.id, countryId, decision === "approve");
  revalidatePath("/admin");
}

export default async function SuperadminHome() {
  const actor = await requireSuperAdmin();
  const [summary, countryProfiles] = await Promise.all([
    getSuperadminSummary(actor.id), readCountryProfilesForReview(actor.id),
  ]);
  const profilesToReview = countryProfiles.filter((profile) => ["review_required", "stale"].includes(profile.status));
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
        <article><span><UsersRound/></span><div><small>VIAGGIATORI</small><strong>{summary.travelers}</strong><p>Profili associati ai gruppi</p></div></article>
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
      <section className="superadminOperations" aria-labelledby="country-profile-title">
        <div className="superadminOperationsHead"><h2 id="country-profile-title">Profili Paese da verificare</h2><p>I profili validi vengono riusati automaticamente. Qui compaiono soltanto anomalie e contenuti scaduti.</p></div>
        {profilesToReview.length===0?<p>Nessun profilo Paese richiede attenzione.</p>:profilesToReview.map((profile)=><article key={profile.countryId} style={{border:"1px solid #d8d4ca",borderRadius:16,padding:18,marginTop:12,background:"#fff"}}>
          <div><small>{profile.iso2} · VERSIONE {profile.version}</small><h3>{profile.countryName}</h3><strong>{profile.status}</strong></div>
          {profile.validationErrors.length>0?<ul>{profile.validationErrors.map((error)=><li key={error}>{error}</li>)}</ul>:null}
          <details><summary>Controlla le fonti ({profile.sources.length})</summary><ul>{profile.sources.map((source,index)=>{const item=source&&typeof source==="object"&&!Array.isArray(source)?source as Record<string,unknown>:{};const url=String(item.url||"");return <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer">{String(item.title||url)}</a> <small>{String(item.category||"")}</small></li>})}</ul></details>
          <form action={reviewCountryProfileAction} style={{display:"flex",gap:8,marginTop:12}}><input type="hidden" name="countryId" value={profile.countryId}/><button type="submit" name="decision" value="approve">Approva</button><button type="submit" name="decision" value="reject">Rifiuta</button></form>
        </article>)}
      </section>
    </div>
  );
}
