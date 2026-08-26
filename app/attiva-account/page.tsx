"use client";

import { FormEvent, useEffect, useState } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, Mail, UserCheck } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import "../login/login.css";
import "../login/login-fix.css";
import "../smf-2026.css";

type Invitation = { name: string; email: string };
export default function ActivateAccountPage() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (!value) { setError("Il link di attivazione è incompleto. Richiedi un nuovo invito alla tua agenzia."); setBusy(false); return; }
    const controller = new AbortController();
    fetch("/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inspect", token: value }), signal: controller.signal })
      .then(async (response) => { const body = await response.json().catch(() => ({})) as Invitation & { error?: string }; if (!response.ok) throw new Error(body.error || "Invito non valido o scaduto"); return body; })
      .then(setInvitation).catch((caught) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Invito non valido"); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (!invitation || password.length < 8 || password !== confirmPassword) { setError("Le password devono coincidere e contenere almeno 8 caratteri."); return; }
    setBusy(true); setError("");
    try {
      const registered = await authClient.signUp.email({ email: invitation.email, password, name: invitation.name });
      if (registered.error) {
        const signedIn = await authClient.signIn.email({ email: invitation.email, password });
        if (signedIn.error) throw new Error("L’account esiste già: usa la password esistente oppure recuperala dalla pagina di login.");
      }
      const activated = await fetch("/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", token }) });
      const body = await activated.json().catch(() => ({})) as { error?: string };
      if (!activated.ok) throw new Error(body.error || "Attivazione non riuscita");
      window.location.replace("/viaggio");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Attivazione non riuscita"); setBusy(false); }
  }

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;

  return <main className="loginPage"><section className="loginStory"><div className="loginPattern"/><div className="loginBrand"><span>SMF</span> SMF Travel</div><div className="loginStoryCopy"><p>IL TUO VIAGGIO È PRONTO</p><h1>Attiva il tuo<br/><em>spazio personale.</em></h1></div></section><section className="loginPanel"><div className="loginBox activationBox"><span className="loginLock"><UserCheck/></span><p className="loginEyebrow">PRIMO ACCESSO</p><h2>{invitation ? `Benvenuto, ${invitation.name}` : "Verifica invito"}</h2>{busy && !invitation && <div className="activationLoading" role="status"><LoaderCircle className="spin"/><span>Verifica dell’invito in corso…</span></div>}{error && <p className="loginError" role="alert"><CircleAlert/> {error}</p>}{!busy && !invitation && <Link className="activationLoginLink" href="/login"><LogIn/> Torna alla pagina di accesso</Link>}{invitation && <form onSubmit={activate}><label htmlFor="activation-email">Email</label><div className="codeInput"><Mail/><input id="activation-email" type="email" autoComplete="email" value={invitation.email} readOnly/></div><label htmlFor="activation-password">Scegli la password</label><div className="codeInput"><LockKeyhole/><input id="activation-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} aria-describedby="activation-password-hint" required/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Nascondi password" : "Mostra password"}>{showPassword ? <EyeOff/> : <Eye/>}</button></div><p id="activation-password-hint" className={password && !passwordLongEnough ? "activationHint invalid" : "activationHint"}>{passwordLongEnough ? "Lunghezza valida" : "Usa almeno 8 caratteri"}</p><label htmlFor="activation-password-confirm">Ripeti la password</label><div className="codeInput"><LockKeyhole/><input id="activation-password-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={128} aria-describedby="activation-match-hint" required/></div>{confirmPassword && <p id="activation-match-hint" className={passwordsMatch ? "activationHint" : "activationHint invalid"}>{passwordsMatch ? "Le password coincidono" : "Le password non coincidono"}</p>}<button type="submit" className="loginSubmit" disabled={busy || !passwordLongEnough || !passwordsMatch}>{busy ? <><LoaderCircle className="spin"/> Attivazione…</> : <><UserCheck/> Attiva account</>}</button></form>}</div></section></main>;
}
