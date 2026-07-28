"use client";

import { FormEvent, Suspense, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Plane } from "lucide-react";
import { useSearchParams } from "next/navigation";
import "./login.css";
import "./login-fix.css";

function LoginContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Non è stato possibile accedere.");
        return;
      }

      const destination = searchParams.get("next");
      const safeDestination = destination?.startsWith("/") && !destination.startsWith("//")
        ? destination
        : "/";
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
        <div className="loginBrand"><span>UZ</span> Via della Seta</div>
        <div className="loginStoryCopy">
          <p>UZBEKISTAN · 1–12 AGOSTO 2026</p>
          <h1>Il viaggio è già<br/><em>iniziato qui.</em></h1>
          <span><Plane size={17}/> Torino · Istanbul · Tashkent</span>
        </div>
        <small>Un diario privato per i nostri tre viaggiatori</small>
      </section>

      <section className="loginPanel">
        <div className="loginBox">
          <span className="loginLock"><LockKeyhole size={24}/></span>
          <p className="loginEyebrow">AREA RISERVATA</p>
          <h2>Bentornato, viaggiatore</h2>
          <p className="loginIntro">Inserisci il codice condiviso con il gruppo per entrare nel diario di viaggio.</p>
          <form onSubmit={submit}>
            <label htmlFor="access-code">Codice del viaggio</label>
            <div className="codeInput">
              <KeyRound size={18}/>
              <input
                id="access-code"
                type={showCode ? "text" : "password"}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Inserisci il codice"
                autoComplete="current-password"
                autoFocus
                required
              />
              <button type="button" onClick={() => setShowCode(!showCode)} aria-label={showCode ? "Nascondi codice" : "Mostra codice"}>
                {showCode ? <EyeOff size={17}/> : <Eye size={17}/>}
              </button>
            </div>
            {error && <p className="loginError" role="alert">{error}</p>}
            <button className="loginSubmit" type="submit" disabled={loading || !code.trim()}>
              {loading ? <LoaderCircle className="spin" size={18}/> : <LockKeyhole size={17}/>}
              {loading ? "Accesso in corso…" : "Entra nel viaggio"}
            </button>
          </form>
          <p className="loginHelp">Non ricordi il codice? Chiedilo a un partecipante del viaggio.</p>
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
