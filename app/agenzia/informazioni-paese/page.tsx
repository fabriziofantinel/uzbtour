import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Globe2, ShieldCheck, XCircle } from "lucide-react";
import { PlatformAuthorizationError, requireAgencyOwnerActor } from "@/lib/platform/authorization";
import { readCountryProfilesForReview, reviewCountryProfile } from "@/lib/platform/country-profile-admin";

export const dynamic = "force-dynamic";

function usefulInformation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const items = record.usefulInfo;
  const governance =
    record.governance && typeof record.governance === "object"
      ? (record.governance as Record<string, unknown>).fields
      : [];
  const criticality = new Map(
    Array.isArray(governance)
      ? governance.map((entry) => {
          const field = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          return [String(field.field || ""), String(field.criticality || "low")];
        })
      : [],
  );
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {}))
    .map((item) => ({
      title: String(item.title || item.category || "Informazione"),
      category: String(item.category || ""),
      criticality: criticality.get(String(item.category || "")) || "low",
      body: String(item.body || ""),
      phone: String(item.phone || ""),
      url: String(item.url || ""),
    }))
    .filter((item) => item.body);
}

async function reviewCountryProfileAction(formData: FormData) {
  "use server";
  const actor = await requireAgencyOwnerActor();
  const agencyId = String(formData.get("agencyId") || "");
  const countryId = String(formData.get("countryId") || "");
  const decision = String(formData.get("decision") || "");
  if (
    ![agencyId, countryId].every((value) => /^[0-9a-f-]{36}$/i.test(value)) ||
    !["approve", "reject"].includes(decision)
  )
    return;
  await reviewCountryProfile(actor.id, agencyId, countryId, decision === "approve");
  revalidatePath("/agenzia/informazioni-paese");
}

export default async function CountryInformationReviewPage() {
  try {
    const actor = await requireAgencyOwnerActor();
    const profiles = await readCountryProfilesForReview(actor.id);
    return (
      <main className="countryReviewPage">
        <header className="countryReviewHero">
          <Link href="/agenzia">
            <ArrowLeft /> Torna ai viaggi
          </Link>
          <div>
            <small>CONTROLLO CONTENUTI</small>
            <h1>Informazioni dei Paesi</h1>
            <p>Il responsabile dell’agenzia verifica fonti e informazioni prima che siano pubblicate ai viaggiatori.</p>
          </div>
        </header>
        <section className="countryReviewIntro">
          <ShieldCheck />
          <div>
            <h2>Validazione a cura dell’agenzia</h2>
            <p>
              L’approvazione vale soltanto per la tua agenzia e per questa versione del profilo. Una versione aggiornata
              dovrà essere controllata nuovamente.
            </p>
          </div>
        </section>
        {profiles.length === 0 ? (
          <section className="countryReviewEmpty">
            <Globe2 />
            <h2>Nessun Paese da verificare</h2>
            <p>I profili compariranno qui dopo la prima elaborazione di un preventivo.</p>
          </section>
        ) : (
          <section className="countryReviewList">
            {profiles.map((profile) => (
              <article key={`${profile.agencyId}-${profile.countryId}`}>
                <header>
                  <div>
                    <small>
                      {profile.iso2} · VERSIONE {profile.version}
                    </small>
                    <h2>{profile.countryName}</h2>
                  </div>
                  <span className={`countryReviewStatus status-${profile.status}`}>
                    {profile.status === "approved"
                      ? "Approvato"
                      : profile.status === "rejected"
                        ? "Rifiutato"
                        : profile.status === "stale"
                          ? "Da aggiornare"
                          : "Da verificare"}
                  </span>
                </header>
                {profile.validationErrors.length > 0 ? (
                  <div className="countryReviewWarnings">
                    <strong>Elementi da controllare</strong>
                    <ul>
                      {profile.validationErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="countryReviewReady">
                    I controlli automatici non hanno rilevato incongruenze. Verifica comunque le fonti prima di
                    approvare.
                  </p>
                )}
                <section
                  className="countryReviewInformation"
                  aria-label={`Informazioni da verificare per ${profile.countryName}`}
                >
                  {usefulInformation(profile.profile).map((item) => (
                    <div key={item.title}>
                      <span className={`countryCriticality criticality-${item.criticality}`}>
                        Criticità{" "}
                        {item.criticality === "high" ? "alta" : item.criticality === "medium" ? "media" : "bassa"}
                      </span>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                      {item.phone ? <a href={`tel:${item.phone}`}>{item.phone}</a> : null}
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          Fonte specifica <ExternalLink />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </section>
                <details>
                  <summary>Controlla le fonti ({profile.sources.length})</summary>
                  <ul>
                    {profile.sources.map((source, index) => {
                      const item =
                        source && typeof source === "object" && !Array.isArray(source)
                          ? (source as Record<string, unknown>)
                          : {};
                      const url = String(item.url || "");
                      return (
                        <li key={`${url}-${index}`}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {String(item.title || url)} <ExternalLink />
                          </a>
                          <small>{String(item.category || "")}</small>
                        </li>
                      );
                    })}
                  </ul>
                </details>
                <form action={reviewCountryProfileAction}>
                  <input type="hidden" name="agencyId" value={profile.agencyId} />
                  <input type="hidden" name="countryId" value={profile.countryId} />
                  <button type="submit" name="decision" value="approve">
                    <CheckCircle2 /> Approva informazioni
                  </button>
                  <button type="submit" name="decision" value="reject">
                    <XCircle /> Rifiuta
                  </button>
                </form>
              </article>
            ))}
          </section>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/agenzia");
    throw error;
  }
}
