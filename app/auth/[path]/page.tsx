import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound, MailCheck, Plane, ShieldCheck } from "lucide-react";
import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths, type AuthViewPath } from "@neondatabase/auth-ui/server";
import AuthProvider from "../auth-provider";
import "@neondatabase/auth-ui/css";
import "../../smf-2026.css";

const allowedPaths = new Set<string>([
  authViewPaths.FORGOT_PASSWORD,
  authViewPaths.RESET_PASSWORD,
  authViewPaths.EMAIL_VERIFICATION,
  authViewPaths.CALLBACK
]);

function getPageCopy(path: string) {
  if (path === authViewPaths.FORGOT_PASSWORD) return {
    eyebrow: "RECUPERO ACCESSO",
    title: "Riprendi il tuo viaggio.",
    description: "Riceverai un collegamento sicuro all’indirizzo associato al tuo account.",
    icon: <KeyRound aria-hidden="true" />
  };
  if (path === authViewPaths.RESET_PASSWORD) return {
    eyebrow: "NUOVA PASSWORD",
    title: "Proteggi il tuo spazio.",
    description: "Scegli una password nuova e diversa da quelle che utilizzi su altri servizi.",
    icon: <ShieldCheck aria-hidden="true" />
  };
  return {
    eyebrow: "VERIFICA ACCOUNT",
    title: "Conferma la tua identità.",
    description: "Completiamo la verifica prima di aprire il tuo spazio personale.",
    icon: <MailCheck aria-hidden="true" />
  };
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (path === authViewPaths.SIGN_IN) redirect("/login");
  if (!allowedPaths.has(path)) notFound();
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
          <AuthProvider>
            <AuthView path={path as AuthViewPath}/>
          </AuthProvider>
          <Link className="authUtilityBack" href="/login"><ArrowLeft aria-hidden="true"/> Torna all’accesso</Link>
        </div>
      </section>
    </main>
  );
}
