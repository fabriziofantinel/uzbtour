import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Accessibility,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Info,
  LogOut,
  MapPinned,
  Save,
  ShieldCheck,
  UserPlus,
  UsersRound,
  XCircle,
} from "lucide-react";
import { PlatformAuthorizationError, requireCurrentAgencyAdmin } from "@/lib/platform/authorization";
import {
  readCountryProfilesForReview,
  reviewCountryProfile,
  saveCountryProfileOverride,
} from "@/lib/platform/country-profile-admin";
import { getPlatformOverview } from "@/lib/platform/repository";
import {
  accessibleBrandBackground,
  accessibleBrandColor,
  agencyLogoSource,
  validBrandColor,
} from "@/lib/platform/branding-ui";

export const dynamic = "force-dynamic";

function usefulInformation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
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
  return (Array.isArray(record.usefulInfo) ? record.usefulInfo : [])
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

function profileStatus(status: string) {
  if (status === "approved") return "Validato dall’agenzia";
  if (status === "rejected") return "Da correggere";
  if (status === "stale") return "Aggiornamento richiesto";
  return "Da validare";
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
  await reviewCountryProfile(actor.nativeId, agencyId, countryId, decision === "approve");
  revalidatePath("/agenzia/informazioni-paese");
}

async function saveCountryProfileAction(formData: FormData) {
  "use server";
  const actor = await requireCurrentAgencyAdmin();
  const agencyId = String(formData.get("agencyId") || "");
  const countryId = String(formData.get("countryId") || "");
  if (![agencyId, countryId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) return;
  const profiles = await readCountryProfilesForReview(actor.nativeId);
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
      readCountryProfilesForReview(actor.nativeId),
      getPlatformOverview(actor),
    ]);
    const agency = overview.agencies[0];
    if (!agency) redirect("/agenzia");
    const color = validBrandColor(agency.primaryColor || "#247A6B");
    const style = {
      "--agency-ui": accessibleBrandBackground(color),
      "--smf-brand": color,
      "--smf-brand-deep": accessibleBrandColor(color),
    } as CSSProperties;

    return (
      <main className="agencyPage countryReviewPage" style={style}>
        <a className="agidSkipLink" href="#country-review-content">
          Salta alle informazioni dei Paesi
        </a>
        <header className="agencyTopbar">
          <Link className="agencyBrand" href="/agenzia">
            {agency.logoUrl ? (
              <img src={agencyLogoSource(agency.logoUrl, agency.id)} alt={`Logo ${agency.name}`} />
            ) : (
              <span>
                {agency.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </span>
            )}
            <div>
              <strong>{agency.name}</strong>
              <small>PANNELLO AGENZIA</small>
            </div>
          </Link>
          <div className="agencyUser">
            <i>{overview.actor.name.slice(0, 2).toUpperCase()}</i>
            <span>
              <small>{agency.role === "editor" ? "Agente" : "Responsabile"}</small>
              <b>{overview.actor.name}</b>
            </span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" aria-label="Esci">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </header>

        <section className="agencyHero countryReviewHero">
          <div>
            <p>
              <ShieldCheck size={15} /> CONTROLLO CONTENUTI
            </p>
            <h1>Informazioni dei Paesi</h1>
            <span>Verifica e personalizza ciò che vedranno i viaggiatori della tua agenzia.</span>
          </div>
        </section>

        <div className="agencyShell">
          <aside className="agencySidebar">
            <nav>
              <Link href="/agenzia">
                <MapPinned size={18} /> Viaggi
              </Link>
              <Link href="/agenzia/agenti">
                <UsersRound size={18} /> Personale
              </Link>
              <Link className="active" href="/agenzia/informazioni-paese" aria-current="page">
                <Globe2 size={18} /> Informazioni Paesi
              </Link>
              <Link href="/agenzia/analytics">
                <BarChart3 size={18} /> Analytics
              </Link>
              <Link href="/agenzia/login-come">
                <UserPlus size={18} /> Login come
              </Link>
              <Link href="/accessibilita">
                <Accessibility size={18} /> Accessibilità
              </Link>
            </nav>
          </aside>

          <section id="country-review-content" className="agencyContent countryReviewContent" tabIndex={-1}>
            <section className="countryReviewIntro">
              <Info />
              <div>
                <h2>Una base comune, contenuti personalizzati</h2>
                <p>
                  L’AI prepara il profilo una sola volta per tutto il sistema. La tua validazione e le tue modifiche
                  restano private all’agenzia. Dopo 180 giorni un nuovo aggiornamento richiederà una nuova validazione.
                </p>
              </div>
            </section>

            {profiles.length === 0 ? (
              <section className="countryReviewEmpty">
                <Globe2 />
                <div>
                  <h2>Nessun profilo Paese disponibile</h2>
                  <p>
                    Il profilo viene creato automaticamente quando il primo preventivo per un nuovo Paese viene
                    elaborato. Non è necessario inserirlo manualmente.
                  </p>
                </div>
              </section>
            ) : (
              <section className="countryReviewList" aria-label="Paesi disponibili">
                {profiles.map((profile, profileIndex) => {
                  const information = usefulInformation(profile.profile);
                  return (
                    <details key={`${profile.agencyId}-${profile.countryId}`} open={profileIndex === 0}>
                      <summary>
                        <span className="countryReviewFlag">{profile.iso2 || "--"}</span>
                        <span>
                          <strong>{profile.countryName}</strong>
                          <small>
                            Versione {profile.version} · aggiornata il{" "}
                            {new Date(profile.groundedAt).toLocaleDateString("it-IT")}
                          </small>
                        </span>
                        <b className={`countryReviewStatus status-${profile.status}`}>
                          {profileStatus(profile.status)}
                        </b>
                      </summary>

                      <div className="countryReviewBody">
                        <div className="countryReviewLifecycle">
                          <CalendarClock />
                          <p>
                            Prossima verifica automatica dopo il{" "}
                            <strong>{new Date(profile.refreshAfter).toLocaleDateString("it-IT")}</strong>. Le modifiche
                            salvate qui sono proprietà della tua agenzia e restano sempre modificabili.
                          </p>
                        </div>

                        {profile.validationErrors.length > 0 ? (
                          <div className="countryReviewWarnings">
                            <strong>Controlli richiesti prima della validazione</strong>
                            <ul>
                              {profile.validationErrors.map((error) => (
                                <li key={error}>{error}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {information.length === 0 ? (
                          <div className="countryReviewInlineEmpty">
                            Le informazioni sono in preparazione. Verranno completate dalla prima elaborazione utile.
                          </div>
                        ) : (
                          <form action={saveCountryProfileAction} className="countryReviewEditor">
                            <input type="hidden" name="agencyId" value={profile.agencyId} />
                            <input type="hidden" name="countryId" value={profile.countryId} />
                            <div className="countryReviewInformation">
                              {information.map((item) => (
                                <fieldset key={`${item.category}-${item.index}`}>
                                  <legend>
                                    <span>{item.category || item.title}</span>
                                    <small className={`countryCriticality criticality-${item.criticality}`}>
                                      {item.criticality === "high"
                                        ? "Dato sensibile"
                                        : item.criticality === "medium"
                                          ? "Da controllare"
                                          : "Informazione generale"}
                                    </small>
                                  </legend>
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
                                  <div className="countryReviewFieldRow">
                                    <label>
                                      Recapito (facoltativo)
                                      <input name={`phone-${item.index}`} defaultValue={item.phone} maxLength={200} />
                                    </label>
                                    <label>
                                      Fonte specifica (facoltativa)
                                      <input
                                        name={`url-${item.index}`}
                                        type="url"
                                        defaultValue={item.url}
                                        maxLength={2000}
                                      />
                                    </label>
                                  </div>
                                </fieldset>
                              ))}
                            </div>
                            <div className="countryReviewActions">
                              <button type="submit" className="countryReviewPrimary">
                                <Save /> Salva e valida per l’agenzia
                              </button>
                              {profile.updatedAt ? (
                                <small>Ultima modifica: {new Date(profile.updatedAt).toLocaleString("it-IT")}</small>
                              ) : null}
                            </div>
                          </form>
                        )}

                        {profile.sources.length > 0 ? (
                          <details className="countryReviewSources">
                            <summary>Fonti usate per il profilo globale ({profile.sources.length})</summary>
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
                        ) : null}

                        {information.length > 0 && profile.status !== "approved" ? (
                          <form action={reviewCountryProfileAction} className="countryReviewDecision">
                            <input type="hidden" name="agencyId" value={profile.agencyId} />
                            <input type="hidden" name="countryId" value={profile.countryId} />
                            <button type="submit" name="decision" value="approve">
                              <CheckCircle2 /> Valida senza modifiche
                            </button>
                            <button type="submit" name="decision" value="reject">
                              <XCircle /> Mantieni da correggere
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </section>
            )}
          </section>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/agenzia");
    throw error;
  }
}
