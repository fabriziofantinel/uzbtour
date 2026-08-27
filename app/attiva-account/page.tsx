"use client";

import { FormEvent, useEffect, useState } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, Mail, UserCheck } from "lucide-react";
import Link from "next/link";
import "../login/login.css";
import "../login/login-fix.css";
import "../smf-2026.css";

type Invitation = { name: string; username: string; email: string };
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
    if (!invitation || password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || password !== confirmPassword) { setError("Le password devono coincidere e contenere almeno 10 caratteri, una maiuscola, una minuscola e un numero."); return; }
    setBusy(true); setError("");
    try {
      const activated = await fetch("/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", token, password }) });
      const body = await activated.json().catch(() => ({})) as { error?: string };
      if (!activated.ok) throw new Error(body.error || "Attivazione non riuscita");
      const meResponse=await fetch("/api/auth/me",{cache:"no-store"});
      const me=await meResponse.json().catch(()=>null) as {user?:{isSuperAdmin?:boolean;isAgencyAdmin?:boolean}}|null;
      const destination=me?.user?.isSuperAdmin?"/admin":me?.user?.isAgencyAdmin?"/agenzia":"/viaggio";
      window.location.replace(destination);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Attivazione non riuscita"); setBusy(false); }
  }

  const passwordLongEnough = password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;

  return <main className="loginPage"><section className="loginStory"><div className="loginPattern"/><div className="loginBrand"><span>SMF</span> SMF Travel</div><div className="loginStoryCopy"><p>IL TUO VIAGGIO È PRONTO</p><h1>Attiva il tuo<br/><em>spazio personale.</em></h1></div></section><section className="loginPanel"><div className="loginBox activationBox"><span className="loginLock"><UserCheck/></span><p className="loginEyebrow">PRIMO ACCESSO</p><h2>{invitation ? `Benvenuto, ${invitation.name}` : "Verifica invito"}</h2>{busy && !invitation && <div className="activationLoading" role="status"><LoaderCircle className="spin"/><span>Verifica dell’invito in corso…</span></div>}{error && <p className="loginError" role="alert"><CircleAlert/> {error}</p>}{!busy && !invitation && <Link className="activationLoginLink" href="/login"><LogIn/> Torna alla pagina di accesso</Link>}{invitation && <form onSubmit={activate}><label htmlFor="activation-username">Username</label><div className="codeInput"><UserCheck/><input id="activation-username" autoComplete="username" value={invitation.username} readOnly/></div><label htmlFor="activation-email">Email per comunicazioni e recupero</label><div className="codeInput"><Mail/><input id="activation-email" type="email" autoComplete="email" value={invitation.email} readOnly/></div><label htmlFor="activation-password">Scegli la password</label><div className="codeInput"><LockKeyhole/><input id="activation-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} aria-describedby="activation-password-hint" required/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Nascondi password" : "Mostra password"}>{showPassword ? <EyeOff/> : <Eye/>}</button></div><p id="activation-password-hint" className={password && !passwordLongEnough ? "activationHint invalid" : "activationHint"}>{passwordLongEnough ? "Requisiti rispettati" : "Almeno 10 caratteri, una maiuscola, una minuscola e un numero"}</p><label htmlFor="activation-password-confirm">Ripeti la password</label><div className="codeInput"><LockKeyhole/><input id="activation-password-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={10} maxLength={128} aria-describedby="activation-match-hint" required/></div>{confirmPassword && <p id="activation-match-hint" className={passwordsMatch ? "activationHint" : "activationHint invalid"}>{passwordsMatch ? "Le password coincidono" : "Le password non coincidono"}</p>}<button type="submit" className="loginSubmit" disabled={busy || !passwordLongEnough || !passwordsMatch}>{busy ? <><LoaderCircle className="spin"/> Attivazione…</> : <><UserCheck/> Attiva account</>}</button></form>}</div></section></main>;
}
