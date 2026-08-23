"use client";

import { FormEvent, Suspense, useState } from "react";
import { CircleUserRound, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Plane } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import "./login.css";
import "./login-fix.css";

function LoginContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError("Email o password non corrette.");
        return;
      }

      const requestedDestination = searchParams.get("next");
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const me = await meResponse.json().catch(() => null) as {
        user?: { isSuperAdmin?: boolean; isAgencyAdmin?: boolean };
      } | null;
      if (!meResponse.ok || !me?.user) {
        await authClient.signOut();
        setError("Account non abilitato a questa applicazione.");
        return;
      }
      const destination = requestedDestination ?? (
        me.user.isSuperAdmin ? "/admin" : me.user.isAgencyAdmin ? "/agenzia" : "/"
      );
      const safeDestination = destination.startsWith("/") && !destination.startsWith("//")
        ? destination : "/";
      window.location.href = safeDestination;
    } catch {
      setError("Connessione non disponibile. Riprova tra poco.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginStory">
        <div className="loginPattern" />
        <div className="loginBrand"><span>SMF</span> SMF Travel</div>
        <div className="loginStoryCopy">
          <p>LA PIATTAFORMA PER LE AGENZIE DI VIAGGIO</p>
          <h1>Ogni viaggio,<br/><em>in un unico spazio.</em></h1>
          <span><Plane size={17}/> Agenzie · famiglie · viaggiatori</span>
        </div>
        <small>Programmi, documenti, ricordi e attività sempre con te.</small>
      </section>

      <section className="loginPanel">
        <div className="loginBox">
          <span className="loginLock"><LockKeyhole size={24}/></span>
          <p className="loginEyebrow">AREA RISERVATA</p>
          <h2>Accedi al tuo spazio</h2>
          <p className="loginIntro">Inserisci le credenziali ricevute dall’agenzia. Verrai indirizzato automaticamente al tuo ambiente.</p>
          <form onSubmit={submit}>
            <label htmlFor="email">Email</label>
            <div className="codeInput">
              <Mail size={18}/>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@esempio.it"
                autoComplete="email"
                autoFocus
                required
              />
            </div>
            <label htmlFor="password">Password</label>
            <div className="codeInput">
              <LockKeyhole size={18}/>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Inserisci la password"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Nascondi password" : "Mostra password"}>
                {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
              </button>
            </div>
            {searchParams.get("configuration") === "missing" && (
              <p className="loginError" role="alert">Autenticazione in configurazione. Riprova tra poco.</p>
            )}
            {error && <p className="loginError" role="alert">{error}</p>}
            <button className="loginSubmit" type="submit" disabled={loading || !email.trim() || !password}>
              {loading ? <LoaderCircle className="spin" size={18}/> : <LockKeyhole size={17}/>}
              {loading ? "Accesso in corso…" : "Accedi"}
            </button>
          </form>
          <p className="loginHelp"><CircleUserRound size={13}/> <a href="/auth/forgot-password">Password dimenticata?</a></p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="loginPage"><section className="loginStory"/><section className="loginPanel"/></main>}>
      <LoginContent />
    </Suspense>
  );
}
