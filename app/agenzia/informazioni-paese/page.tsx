import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Globe2, ShieldCheck, XCircle } from "lucide-react";
import { PlatformAuthorizationError, requireCurrentAgencyAdmin } from "@/lib/platform/authorization";
import {
  readCountryProfilesForReview,
  reviewCountryProfile,
  saveCountryProfileOverride,
} from "@/lib/platform/country-profile-admin";
import { getPlatformOverview } from "@/lib/platform/repository";
import { validBrandColor } from "@/lib/platform/branding-ui";

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
    .map((item, index) => ({
      index,
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
  const actor = await requireCurrentAgencyAdmin();
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

async function saveCountryProfileAction(formData: FormData) {
  "use server";
  const actor = await requireCurrentAgencyAdmin();
  const agencyId = String(formData.get("agencyId") || "");
  const countryId = String(formData.get("countryId") || "");
  if (![agencyId, countryId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) return;
  const profiles = await readCountryProfilesForReview(actor.id);
  const selected = profiles.find((profile) => profile.agencyId === agencyId && profile.countryId === countryId);
  if (!selected?.profile || typeof selected.profile !== "object" || Array.isArray(selected.profile)) return;
  const profile = structuredClone(selected.profile) as Record<string, unknown>;
  const items = Array.isArray(profile.usefulInfo) ? profile.usefulInfo : [];
  profile.usefulInfo = items.map((item, index) => {
    const current = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    return {
      ...current,
      title: String(formData.get(`title-${index}`) || current.title || current.category || "Informazione").slice(
        0,
        160,
      ),
      body: String(formData.get(`body-${index}`) || "")
        .trim()
        .slice(0, 8000),
      phone: String(formData.get(`phone-${index}`) || "")
        .trim()
        .slice(0, 200),
      url: String(formData.get(`url-${index}`) || "")
        .trim()
        .slice(0, 2000),
    };
  });
  await saveCountryProfileOverride(actor.nativeId, agencyId, countryId, profile);
  revalidatePath("/agenzia/informazioni-paese");
}

export default async function CountryInformationReviewPage() {
  try {
    const actor = await requireCurrentAgencyAdmin();
    const [profiles, overview] = await Promise.all([
      readCountryProfilesForReview(actor.id),
      getPlatformOverview(actor),
    ]);
    const agency = overview.agencies[0];
    const color = validBrandColor(agency?.primaryColor || "#247A6B");
    return (
      <main
        className="countryReviewPage"
        style={{ "--agency-color": color, "--smf-brand": color, "--smf-action": color } as CSSProperties}
      >
        <header className="countryReviewHero">
          <Link href="/agenzia">
            <ArrowLeft /> Torna ai viaggi
          </Link>
          <div>
            <small>CONTROLLO CONTENUTI</small>
            <h1>Informazioni dei Paesi</h1>
            <p>Responsabile e agenti verificano e personalizzano le informazioni pubblicate ai viaggiatori.</p>
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
                <form action={saveCountryProfileAction}>
                  <input type="hidden" name="agencyId" value={profile.agencyId} />
                  <input type="hidden" name="countryId" value={profile.countryId} />
                  <section
                    className="countryReviewInformation"
                    aria-label={`Informazioni modificabili per ${profile.countryName}`}
                  >
                    {usefulInformation(profile.profile).map((item) => (
                      <div key={`${item.title}-${item.index}`}>
                        <span className={`countryCriticality criticality-${item.criticality}`}>
                          Criticità{" "}
                          {item.criticality === "high" ? "alta" : item.criticality === "medium" ? "media" : "bassa"}
                        </span>
                        <label>
                          Titolo
                          <input name={`title-${item.index}`} defaultValue={item.title} maxLength={160} />
                        </label>
                        <label>
                          Informazione
                          <textarea
                            name={`body-${item.index}`}
                            defaultValue={item.body}
                            rows={5}
                            required
                            maxLength={8000}
                          />
                        </label>
                        <label>
                          Recapito (facoltativo)
                          <input name={`phone-${item.index}`} defaultValue={item.phone} maxLength={200} />
                        </label>
                        <label>
                          Fonte specifica (facoltativa)
                          <input name={`url-${item.index}`} type="url" defaultValue={item.url} maxLength={2000} />
                        </label>
                      </div>
                    ))}
                  </section>
                  <button type="submit">
                    <CheckCircle2 /> Salva modifiche dell’agenzia
                  </button>
                  {profile.updatedAt ? (
                    <small>Ultima modifica: {new Date(profile.updatedAt).toLocaleString("it-IT")}</small>
                  ) : null}
                </form>
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
