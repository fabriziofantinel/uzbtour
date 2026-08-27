import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound, Plane } from "lucide-react";
import "../../smf-2026.css";
import UsernameRecovery from "../username-recovery";

const RECOVERY_PATHS = new Set(["forgot-password", "reset-password"]);

function getPageCopy(path: string) {
  if (path === "forgot-password") return {
    eyebrow: "RECUPERO ACCESSO",
    title: "Riprendi il tuo viaggio.",
    description: "Riceverai un collegamento sicuro all’indirizzo associato al tuo account.",
    icon: <KeyRound aria-hidden="true" />
  };
  return {
    eyebrow: "NUOVA PASSWORD",
    title: "Proteggi il tuo spazio.",
    description: "Inserisci il codice ricevuto e scegli una nuova password.",
    icon: <KeyRound aria-hidden="true" />
  };
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (path === "sign-in") redirect("/login");
  if (!RECOVERY_PATHS.has(path)) notFound();
  const copy = getPageCopy(path);

  return (
    <main className="authUtilityPage">
      <section className="authUtilityStory" aria-labelledby="auth-utility-title">
        <Link className="authUtilityBrand" href="/login" aria-label="SMF Travel, torna alla pagina di accesso">
          <span>SMF</span>
          <strong>SMF Travel</strong>
        </Link>
        <div className="authUtilityStoryCopy">
          <p>{copy.eyebrow}</p>
          <h1 id="auth-utility-title">{copy.title}</h1>
          <span><Plane aria-hidden="true"/> Agenzie, famiglie e viaggiatori in un unico spazio.</span>
        </div>
      </section>
      <section className="authUtilityPanel">
        <div className="authUtilityBox">
          <span className="authUtilityIcon">{copy.icon}</span>
          <p className="authUtilityIntro">{copy.description}</p>
          <UsernameRecovery/>
          <Link className="authUtilityBack" href="/login"><ArrowLeft aria-hidden="true"/> Torna all’accesso</Link>
        </div>
      </section>
    </main>
  );
}
